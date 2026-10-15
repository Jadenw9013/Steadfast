import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";

/**
 * T-2059 — deploy-time reconciliation for audit RELATIONSHIP-AUDIT-2026-10-15
 * D1 (stale ClientCoachingContext) and D3 (NULL Message.coachId written by the
 * deployed main), proved on a replayed database seeded with the drift shapes
 * the audit describes:
 *
 *   NONE_BUT_COACHED     context NONE, then a main-style CoachClient insert (probe STALE-A)
 *   HUMAN_POINTER_NULL   context HUMAN, main-style delete + re-link; FK SET NULL drops the pointer (probe STALE-B)
 *   coachless stale      context HUMAN, main-style delete, no new coach
 *   STALE_RESOLUTION     backfill flagged 2 rows, main later deleted one
 *   MISSING_CONTEXT      CoachClient row with no context row
 *   POINTER_MISMATCH     context HUMAN on row 1, main inserted a second coach's row
 * plus controls that must not change (consistent HUMAN, consistent NONE,
 * genuinely ambiguous, AI). Messages: single-coach client, a client who has had
 * two coaches, a client with two CoachClient rows, and a NONE_BUT_COACHED
 * client whose replies only become attributable after the D1 step.
 *
 * For each script: the dry run reports the drift and writes nothing, the apply
 * fixes it, and a second apply changes 0 rows.
 *
 * Round 2 (review T-2059-r1): the OVERLAP fixture is the reviewer's probe. Coach
 * P and coach Q both had rows at once (backfill flagged it), main purged Q, and
 * the client's reply to Q survives with coachId NULL. D1 clears the stale flag
 * to P, so D3 must take the overlap manifest D1 wrote and exclude the client:
 * the reply to Q must never get coachId P. The EVIDENCE fixtures are
 * single-coach clients with another coach's footprint (an upload after the
 * survivor's row; an accepted invite) and must be excluded the same way. The CLIs are run as real child
 * processes against the same database. The C2b SQL file is asserted to count
 * exactly what the script classifies.
 *
 * WARNING — like message-coach-backfill.test.ts, both scripts are DATABASE-WIDE
 * by design (that is what runs on deploy), so this file reconciles and
 * attributes any other file's rows in the same database. Run it on its own
 * replayed database or with `--no-file-parallelism` / `--maxWorkers=1`.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { db } from "@/lib/db";
import { getClientProvider } from "@/lib/queries/client-provider";
import {
  BLOCKING_STATES,
  DRIFT_STATES,
  scanCoachingContextDrift,
  applyCoachingContextReconciliation,
  type ContextState,
} from "@/lib/maintenance/coaching-context-drift";
import { reattributeMessageCoach, PINNED_T661_SHA256 } from "@/lib/maintenance/message-coach-reattribution";
import { manifestPathFor, readOverlapManifest, recordOverlapClients } from "@/lib/maintenance/overlap-manifest";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

const C2B_SQL = readFileSync(path.join(process.cwd(), "scripts/sql/C2b-context-drift.sql"), "utf8");
const confirmKey = () => {
  const url = new URL(process.env.DATABASE_URL!);
  return `${url.hostname}/${url.pathname.slice(1)}`;
};
const runDir = mkdtempSync(path.join(os.tmpdir(), "t2059-run-"));
const manifestFile = manifestPathFor(runDir);
const manifestIds = () => readOverlapManifest(manifestFile, confirmKey()).clients.map((c) => c.clientId);

function runCli(script: string, args: string[]) {
  const res = spawnSync("pnpm", ["exec", "tsx", `scripts/${script}`, ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

async function c2bCounts() {
  const [row] = await db.$queryRawUnsafe<Array<Record<string, bigint>>>(C2B_SQL);
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
}

async function contextRows(ids: string[]) {
  return db.clientCoachingContext.findMany({
    where: { clientId: { in: ids } },
    select: { clientId: true, mode: true, activeCoachClientId: true, resolutionRequired: true, revision: true, updatedAt: true },
    orderBy: { clientId: "asc" },
  });
}

async function coachClientRows() {
  return db.coachClient.findMany({ select: { id: true, coachId: true, clientId: true, createdAt: true }, orderBy: { id: "asc" } });
}

suite("T-2059 — deploy-time context reconciliation and message re-attribution", () => {
  afterAll(async () => { rmSync(runDir, { recursive: true, force: true }); await db.$disconnect(); });

  async function makeUser(role: "coach" | "client", label: string) {
    const id = randomUUID();
    return db.user.create({
      data: {
        clerkId: id,
        email: `t2059-${label}-${id}@example.test`,
        firstName: `T2059${label}`,
        isCoach: role === "coach",
        isClient: role === "client",
        activeRole: role === "coach" ? "COACH" : "CLIENT",
      },
    });
  }

  const at = (iso: string) => new Date(iso);
  const weekOf = at("2026-09-28T00:00:00Z");
  const f: Record<string, { id: string; email: string }> = {};
  const coaches: Record<string, { id: string }> = {};
  const rows: Record<string, string> = {};
  const msgs: Record<string, string> = {};
  const expectedBefore: Record<string, ContextState> = {};
  const expectedAfter: Record<string, ContextState> = {};

  beforeAll(async () => {
    for (const c of ["A", "B", "C", "D", "E", "X", "Y", "P", "Q", "R", "S", "T"]) coaches[c] = await makeUser("coach", `coach${c}`);
    const linkMain = (coachId: string, clientId: string, createdAt: Date) =>
      db.coachClient.create({ data: { coachId, clientId, createdAt } }).then((r) => r.id);

    // 1. NONE_BUT_COACHED (STALE-A): backfilled NONE, main then linked coach A.
    f.noneCoached = await makeUser("client", "noneCoached");
    await db.clientCoachingContext.create({ data: { clientId: f.noneCoached.id, mode: "NONE", revision: 1 } });
    rows.noneCoached = await linkMain(coaches.A.id, f.noneCoached.id, at("2026-10-01T00:00:00Z"));
    expectedBefore.noneCoached = "NONE_BUT_COACHED"; expectedAfter.noneCoached = "HUMAN_OK";

    // 2. HUMAN_POINTER_NULL (STALE-B): backfilled HUMAN, main removed and re-linked the same coach.
    f.relinked = await makeUser("client", "relinked");
    const old = await linkMain(coaches.B.id, f.relinked.id, at("2026-05-04T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.relinked.id, mode: "HUMAN", activeCoachClientId: old, revision: 1 } });
    await db.coachClient.delete({ where: { id: old } });
    rows.relinked = await linkMain(coaches.B.id, f.relinked.id, at("2026-10-12T00:00:00Z"));
    expectedBefore.relinked = "HUMAN_POINTER_NULL"; expectedAfter.relinked = "HUMAN_OK";

    // 3. Coachless with a stale HUMAN context: main removed the only coach.
    f.coachless = await makeUser("client", "coachless");
    const gone = await linkMain(coaches.C.id, f.coachless.id, at("2026-06-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.coachless.id, mode: "HUMAN", activeCoachClientId: gone, revision: 1 } });
    await db.coachClient.delete({ where: { id: gone } });
    expectedBefore.coachless = "HUMAN_POINTER_NULL"; expectedAfter.coachless = "NONE_OK";

    // 4. STALE_RESOLUTION: the A01 backfill saw 2 rows (mode NONE, flagged); main deleted one.
    f.staleFlag = await makeUser("client", "staleFlag");
    rows.staleFlag = await linkMain(coaches.D.id, f.staleFlag.id, at("2026-04-01T00:00:00Z"));
    const dropped = await linkMain(coaches.E.id, f.staleFlag.id, at("2026-04-02T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.staleFlag.id, mode: "NONE", resolutionRequired: true, revision: 1 } });
    await db.coachClient.delete({ where: { id: dropped } });
    expectedBefore.staleFlag = "STALE_RESOLUTION"; expectedAfter.staleFlag = "HUMAN_OK";

    // 5. MISSING_CONTEXT: a CoachClient row with no context row (e.g. a non-isClient user at backfill time).
    f.noContext = await makeUser("client", "noContext");
    rows.noContext = await linkMain(coaches.A.id, f.noContext.id, at("2026-10-05T00:00:00Z"));
    expectedBefore.noContext = "MISSING_CONTEXT"; expectedAfter.noContext = "HUMAN_OK";

    // 6. POINTER_MISMATCH: HUMAN on coach A, main let coach B link too (S5 on main).
    f.twoOnMain = await makeUser("client", "twoOnMain");
    const first = await linkMain(coaches.A.id, f.twoOnMain.id, at("2026-03-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.twoOnMain.id, mode: "HUMAN", activeCoachClientId: first, revision: 1 } });
    await linkMain(coaches.B.id, f.twoOnMain.id, at("2026-10-02T00:00:00Z"));
    expectedBefore.twoOnMain = "HUMAN_POINTER_MISMATCH"; expectedAfter.twoOnMain = "AMBIGUOUS_WITH_CAUSE";

    // Controls that must not be written.
    f.okHuman = await makeUser("client", "okHuman");
    rows.okHuman = await linkMain(coaches.X.id, f.okHuman.id, at("2026-02-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.okHuman.id, mode: "HUMAN", activeCoachClientId: rows.okHuman, revision: 1 } });
    expectedBefore.okHuman = expectedAfter.okHuman = "HUMAN_OK";

    f.okNone = await makeUser("client", "okNone");
    await db.clientCoachingContext.create({ data: { clientId: f.okNone.id, mode: "NONE", revision: 1 } });
    expectedBefore.okNone = expectedAfter.okNone = "NONE_OK";

    f.ambiguous = await makeUser("client", "ambiguous");
    await linkMain(coaches.A.id, f.ambiguous.id, at("2026-01-01T00:00:00Z"));
    await linkMain(coaches.B.id, f.ambiguous.id, at("2026-01-02T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.ambiguous.id, mode: "HUMAN", resolutionRequired: true, revision: 1 } });
    expectedBefore.ambiguous = expectedAfter.ambiguous = "AMBIGUOUS_WITH_CAUSE";

    f.ai = await makeUser("client", "ai");
    await linkMain(coaches.C.id, f.ai.id, at("2026-01-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.ai.id, mode: "AI", revision: 3 } });
    expectedBefore.ai = expectedAfter.ai = "AI_SKIPPED";

    // ── D3 message fixtures (every row NULL coachId, as main wrote them) ──
    const msg = (clientId: string, senderId: string, body: string, createdAt: string) =>
      db.message.create({ data: { clientId, senderId, body, createdAt: at(createdAt), weekOf, coachId: null } }).then((m) => m.id);

    // Single-coach client, consistent context.
    msgs.singleCoachSent = await msg(f.okHuman.id, coaches.X.id, "t2059 X to okHuman", "2026-10-01T10:00:00Z");
    msgs.singleClientReply = await msg(f.okHuman.id, f.okHuman.id, "t2059 okHuman reply", "2026-10-01T11:00:00Z");
    msgs.singleBeforeRow = await msg(f.okHuman.id, f.okHuman.id, "t2059 okHuman before row", "2026-01-15T11:00:00Z");

    // Client who has had two coaches: Y's row predates X's later activity (predecessor survivor).
    f.twoCoaches = await makeUser("client", "twoCoaches");
    rows.twoCoaches = await linkMain(coaches.Y.id, f.twoCoaches.id, at("2026-08-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.twoCoaches.id, mode: "HUMAN", activeCoachClientId: rows.twoCoaches, revision: 1 } });
    expectedBefore.twoCoaches = expectedAfter.twoCoaches = "HUMAN_OK";
    msgs.otherCoachSent = await msg(f.twoCoaches.id, coaches.X.id, "t2059 X to twoCoaches", "2026-09-01T10:00:00Z");
    msgs.twoCoachesReply = await msg(f.twoCoaches.id, f.twoCoaches.id, "t2059 twoCoaches reply", "2026-09-02T10:00:00Z");

    // Client with two CoachClient rows today.
    msgs.ambiguousReply = await msg(f.ambiguous.id, f.ambiguous.id, "t2059 ambiguous reply", "2026-10-03T10:00:00Z");
    msgs.ambiguousCoachSent = await msg(f.ambiguous.id, coaches.A.id, "t2059 A to ambiguous", "2026-10-03T09:00:00Z");

    // NONE_BUT_COACHED client: attributable only once D1 has run.
    msgs.staleReply = await msg(f.noneCoached.id, f.noneCoached.id, "t2059 noneCoached reply", "2026-10-02T10:00:00Z");

    // OVERLAP (review r1 finding 1 probe): P row 04-01, Q row 04-02, backfill flagged the client.
    // Main purges Q (its CoachClient row and Q's own messages). The client's reply to Q survives as NULL.
    f.overlap = await makeUser("client", "overlap");
    rows.overlap = await linkMain(coaches.P.id, f.overlap.id, at("2026-04-01T00:00:00Z"));
    const qRow = await linkMain(coaches.Q.id, f.overlap.id, at("2026-04-02T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.overlap.id, mode: "NONE", resolutionRequired: true, revision: 1 } });
    const qSent = await msg(f.overlap.id, coaches.Q.id, "t2059 Q to overlap", "2026-04-05T10:00:00Z");
    msgs.overlapReplyToQ = await msg(f.overlap.id, f.overlap.id, "t2059 private reply written to coach Q", "2026-04-06T10:00:00Z");
    msgs.overlapPSent = await msg(f.overlap.id, coaches.P.id, "t2059 P to overlap", "2026-04-07T10:00:00Z");
    await db.message.delete({ where: { id: qSent } }); // purge deletes the departed coach's Message rows
    await db.coachClient.delete({ where: { id: qRow } }); // ...and their CoachClient row
    expectedBefore.overlap = "STALE_RESOLUTION"; expectedAfter.overlap = "HUMAN_OK";

    // OVERLAP B: the reviewer's second probe client (same shape), for the RUN1/RUN2 reproduction.
    f.overlapB = await makeUser("client", "overlapB");
    rows.overlapB = await linkMain(coaches.P.id, f.overlapB.id, at("2026-04-01T00:00:00Z"));
    const qRowB = await linkMain(coaches.Q.id, f.overlapB.id, at("2026-04-02T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.overlapB.id, mode: "NONE", resolutionRequired: true, revision: 1 } });
    msgs.overlapBReplyToQ = await msg(f.overlapB.id, f.overlapB.id, "t2059 B private reply written to coach Q", "2026-04-06T10:00:00Z");
    await db.coachClient.delete({ where: { id: qRowB } });
    expectedBefore.overlapB = "STALE_RESOLUTION"; expectedAfter.overlapB = "HUMAN_OK";

    // EVIDENCE 1: single coach R, but coach S uploaded a plan for the client after R's row existed.
    f.evidenceUpload = await makeUser("client", "evidenceUpload");
    rows.evidenceUpload = await linkMain(coaches.R.id, f.evidenceUpload.id, at("2026-07-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.evidenceUpload.id, mode: "HUMAN", activeCoachClientId: rows.evidenceUpload, revision: 1 } });
    await db.mealPlanUpload.create({ data: { coachId: coaches.S.id, clientId: f.evidenceUpload.id, storagePath: "t2059/synthetic.pdf", createdAt: at("2026-08-01T00:00:00Z") } });
    msgs.evidenceUploadReply = await msg(f.evidenceUpload.id, f.evidenceUpload.id, "t2059 evidenceUpload reply", "2026-08-02T10:00:00Z");
    expectedBefore.evidenceUpload = expectedAfter.evidenceUpload = "HUMAN_OK";

    // EVIDENCE 2: single coach R, but the client accepted coach T's invite (no acceptance time is stored).
    f.evidenceInvite = await makeUser("client", "evidenceInvite");
    rows.evidenceInvite = await linkMain(coaches.R.id, f.evidenceInvite.id, at("2026-07-01T00:00:00Z"));
    await db.clientCoachingContext.create({ data: { clientId: f.evidenceInvite.id, mode: "HUMAN", activeCoachClientId: rows.evidenceInvite, revision: 1 } });
    await db.clientInvite.create({ data: { coachId: coaches.T.id, email: f.evidenceInvite.email, name: "SYNTHETIC", status: "ACCEPTED", expiresAt: at("2026-07-10T00:00:00Z"), createdAt: at("2026-06-20T00:00:00Z") } });
    msgs.evidenceInviteReply = await msg(f.evidenceInvite.id, f.evidenceInvite.id, "t2059 evidenceInvite reply", "2026-08-02T10:00:00Z");
    expectedBefore.evidenceInvite = expectedAfter.evidenceInvite = "HUMAN_OK";
  }, 60_000);

  const fixtureIds = () => Object.values(f).map((u) => u.id);
  const emails = () => Object.values(f).map((u) => u.email);
  const coachIdOf = async (id: string) => (await db.message.findUniqueOrThrow({ where: { id }, select: { coachId: true } })).coachId;

  it("the scan classifies every audit drift shape and the controls", async () => {
    const report = await scanCoachingContextDrift();
    const drifted = new Map(report.drifted.map((d) => [d.clientId, d]));
    for (const [key, user] of Object.entries(f)) {
      const d = drifted.get(user.id);
      if (expectedBefore[key] === expectedAfter[key]) {
        expect(d, key).toBeUndefined();
      } else {
        expect(d?.before, key).toBe(expectedBefore[key]);
        expect(d?.after, key).toBe(expectedAfter[key]);
      }
    }
    expect(report.aiWithCoachClient).toContain(f.ai.id);
  });

  it("C2b SQL counts exactly what the script classifies (read-only twin)", async () => {
    const report = await scanCoachingContextDrift();
    const sql = await c2bCounts();
    expect(sql.none_but_coached).toBe(report.byState.NONE_BUT_COACHED);
    expect(sql.human_pointer_null).toBe(report.byState.HUMAN_POINTER_NULL);
    expect(sql.stale_resolution).toBe(report.byState.STALE_RESOLUTION);
    expect(sql.human_pointer_mismatch).toBe(report.byState.HUMAN_POINTER_MISMATCH);
    expect(sql.none_with_pointer).toBe(report.byState.NONE_WITH_POINTER);
    expect(sql.missing_context).toBe(report.byState.MISSING_CONTEXT);
    expect(sql.would_change_total).toBe(report.drifted.length);
    expect(sql.human_ok).toBe(report.byState.HUMAN_OK);
    expect(sql.none_ok).toBe(report.byState.NONE_OK);
    expect(sql.ambiguous_with_cause).toBe(report.byState.AMBIGUOUS_WITH_CAUSE);
    expect(sql.ai_skipped).toBe(report.byState.AI_SKIPPED);
    expect(sql.population).toBe(report.population);
    // Every seeded drift shape is present.
    for (const key of ["none_but_coached", "human_pointer_null", "stale_resolution", "human_pointer_mismatch", "missing_context"]) {
      expect(sql[key], key).toBeGreaterThan(0);
    }
  });

  it("before the D1 step, the release candidate shows the audit's symptoms", async () => {
    expect((await getClientProvider(f.noneCoached.id)).coachId).toBeNull(); // looks coachless
    expect((await getClientProvider(f.relinked.id)).resolutionRequired).toBe(true); // 409
    expect((await getClientProvider(f.coachless.id)).resolutionRequired).toBe(true); // never reaches the no-coach screen
    expect((await getClientProvider(f.staleFlag.id)).resolutionRequired).toBe(true); // 409 forever
  });

  it("D3 refuses without the overlap manifest, and while contexts are drifted; writes nothing", async () => {
    const noManifest = runCli("reattribute-message-coach.ts", ["--apply", `--confirm-db=${confirmKey()}`]);
    expect(noManifest.status, noManifest.out).toBe(2);
    expect(noManifest.out).toContain("--manifest=<run-dir>/coaching-context-overlap-manifest.json is required");
    const missing = runCli("reattribute-message-coach.ts", [`--manifest=${manifestFile}`]);
    expect(missing.status, missing.out).toBe(2);
    expect(missing.out).toContain("Overlap manifest not found");

    const scratch = mkdtempSync(path.join(os.tmpdir(), "t2059-empty-"));
    try {
      const empty = recordOverlapClients(scratch, confirmKey(), [], { init: true }).file;
      const drifted = runCli("reattribute-message-coach.ts", [`--manifest=${empty}`, "--apply", `--confirm-db=${confirmKey()}`]);
      expect(drifted.status, drifted.out).toBe(1);
      expect(drifted.out).toContain("Run scripts/reconcile-coaching-context.ts --apply first");
      const wrongTarget = recordOverlapClients(mkdtempSync(path.join(scratch, "x-")), "otherhost/otherdb", [], { init: true }).file;
      const refused = runCli("reattribute-message-coach.ts", [`--manifest=${wrongTarget}`]);
      expect(refused.status, refused.out).toBe(2);
      expect(refused.out).toContain("was written for otherhost/otherdb");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    expect(await coachIdOf(msgs.singleCoachSent)).toBeNull();
  }, 60_000);

  it("D1 dry run (CLI) lists drifted ids only, predicts 0 blocking, and writes nothing", async () => {
    const contextsBefore = await contextRows(fixtureIds());
    const ccBefore = await coachClientRows();
    const res = runCli("reconcile-coaching-context.ts", []);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("DRY RUN");
    for (const key of Object.keys(f)) {
      if (expectedBefore[key] !== expectedAfter[key]) expect(res.out, key).toContain(f[key].id);
    }
    expect(res.out).toContain("NONE_BUT_COACHED -> HUMAN_OK");
    expect(res.out).toContain("HUMAN_POINTER_NULL -> HUMAN_OK");
    expect(res.out).toContain("HUMAN_POINTER_NULL -> NONE_OK");
    expect(res.out).toContain("STALE_RESOLUTION -> HUMAN_OK");
    expect(res.out).toContain("blocking states: NONE_BUT_COACHED=0 HUMAN_POINTER_NULL=0 STALE_RESOLUTION=0");
    expect(res.out).toContain("RESULT: OK");
    for (const email of emails()) expect(res.out).not.toContain(email);
    expect(res.out).not.toMatch(/T2059[a-zA-Z]/); // no first names
    expect(await contextRows(fixtureIds())).toEqual(contextsBefore);
    expect(await coachClientRows()).toEqual(ccBefore);
  }, 60_000);

  it("--apply needs --confirm-db=<host>/<db> (database name alone is refused) and --run-dir", async () => {
    const none = runCli("reconcile-coaching-context.ts", ["--apply", `--run-dir=${runDir}`]);
    expect(none.status).toBe(2);
    expect(none.out).toContain(`--confirm-db=${confirmKey()}`);
    const dbOnly = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${new URL(process.env.DATABASE_URL!).pathname.slice(1)}`, `--run-dir=${runDir}`]);
    expect(dbOnly.status).toBe(2);
    expect(dbOnly.out).toContain(`Confirm the host and database exactly: --apply --confirm-db=${confirmKey()}`);
    const noRunDir = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${confirmKey()}`]);
    expect(noRunDir.status).toBe(2);
    expect(noRunDir.out).toContain("--apply needs --run-dir=<dir>");
    // r3: an apply may not create a manifest unless it is the deploy's first (--init-manifest).
    const noInit = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${confirmKey()}`, `--run-dir=${runDir}`]);
    expect(noInit.status, noInit.out).toBe(2);
    expect(noInit.out).toContain("No overlap manifest at");
    expect((await scanCoachingContextDrift()).drifted.length).toBeGreaterThan(0);
  }, 60_000);

  it("a client that turns STALE_RESOLUTION after the scan is not cleared unrecorded; the run continues and lists it", async () => {
    const client = await makeUser("client", "lateFlag");
    const coach = await makeUser("coach", "lateFlagCoach");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", resolutionRequired: true, revision: 1 } });
    const okClient = f.noContext.id; // still drifted, must still be processed after the failure
    const results = await applyCoachingContextReconciliation([client.id, okClient], new Set());
    expect(results[0]).toMatchObject({ clientId: client.id, changed: false });
    expect(results[0].error).toContain("not in the overlap manifest");
    expect(results[1]).toMatchObject({ clientId: okClient, changed: true, after: "HUMAN_OK" });
    expect((await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } })).resolutionRequired).toBe(true);
    // Leave it for the CLI apply below (which records it in the manifest first).
    f.lateFlag = client;
    expectedBefore.lateFlag = "STALE_RESOLUTION"; expectedAfter.lateFlag = "HUMAN_OK";
    rows.noContextDone = okClient;
  }, 60_000);

  it("D1 --apply (CLI) fixes every shape, leaves CoachClient, AI and consistent rows untouched", async () => {
    const ccBefore = await coachClientRows();
    const controlsBefore = await contextRows([f.okHuman.id, f.okNone.id, f.ambiguous.id, f.ai.id, f.twoCoaches.id]);
    const res = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${confirmKey()}`, `--run-dir=${runDir}`, "--init-manifest"]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("RESULT: OK, 0 clients in a blocking state");
    // The manifest records every client moved out of STALE_RESOLUTION and every 2+ row client.
    const listed = readOverlapManifest(manifestFile, confirmKey()).clients;
    const reasonsOf = (id: string) => listed.find((c) => c.clientId === id)?.reasons ?? [];
    expect(reasonsOf(f.overlap.id)).toContain("STALE_RESOLUTION_CLEARED");
    expect(reasonsOf(f.overlapB.id)).toContain("STALE_RESOLUTION_CLEARED");
    expect(reasonsOf(f.staleFlag.id)).toContain("STALE_RESOLUTION_CLEARED");
    expect(reasonsOf(f.lateFlag.id)).toContain("STALE_RESOLUTION_CLEARED");
    expect(reasonsOf(f.ambiguous.id)).toContain("MULTIPLE_COACHCLIENT_ROWS");
    expect(reasonsOf(f.twoOnMain.id)).toContain("MULTIPLE_COACHCLIENT_ROWS");
    expect(reasonsOf(f.okHuman.id)).toEqual([]);
    for (const email of emails()) expect(readFileSync(manifestFile, "utf8")).not.toContain(email);
    for (const email of emails()) expect(res.out).not.toContain(email);

    expect(await coachClientRows()).toEqual(ccBefore);
    expect(await contextRows([f.okHuman.id, f.okNone.id, f.ambiguous.id, f.ai.id, f.twoCoaches.id])).toEqual(controlsBefore);

    const after = await scanCoachingContextDrift();
    for (const s of DRIFT_STATES) expect(after.byState[s], s).toBe(0);
    for (const s of BLOCKING_STATES) expect(after.byState[s], s).toBe(0);
    const c2b = await c2bCounts();
    expect(c2b.would_change_total).toBe(0);

    const provider = async (key: string) => getClientProvider(f[key].id);
    expect((await provider("noneCoached")).coachId).toBe(coaches.A.id);
    expect((await provider("noneCoached")).activeCoachClientId).toBe(rows.noneCoached);
    expect((await provider("relinked")).coachId).toBe(coaches.B.id);
    expect((await provider("relinked")).resolutionRequired).toBe(false);
    expect((await provider("coachless")).origin).toBe("NONE");
    expect((await provider("coachless")).resolutionRequired).toBe(false);
    expect((await provider("staleFlag")).coachId).toBe(coaches.D.id);
    expect((await provider("overlap")).coachId).toBe(coaches.P.id); // the surviving coach is restored
    expect((await provider("noContext")).coachId).toBe(coaches.A.id);
    expect(await db.clientCoachingContext.findUnique({ where: { clientId: f.noContext.id } })).not.toBeNull();
    // Genuine ambiguity is surfaced, never guessed.
    expect((await provider("twoOnMain")).resolutionRequired).toBe(true);
    expect((await provider("twoOnMain")).coachId).toBeNull();
    expect((await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: f.ai.id } })).mode).toBe("AI");
  }, 60_000);

  it("a second D1 --apply changes 0 rows", async () => {
    const before = await contextRows(fixtureIds());
    const manifestBefore = manifestIds();
    const dry = runCli("reconcile-coaching-context.ts", []);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toContain("WOULD CHANGE (0 clients");
    const res = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${confirmKey()}`, `--run-dir=${runDir}`]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("CHANGED (0 clients");
    expect(await contextRows(fixtureIds())).toEqual(before);
    const reinit = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${confirmKey()}`, `--run-dir=${runDir}`, "--init-manifest"]);
    expect(reinit.status, reinit.out).toBe(2);
    expect(reinit.out).toContain("--init-manifest refused");
    // Cumulative: the second apply sees no STALE_RESOLUTION any more but forgets nobody.
    expect(manifestIds()).toEqual(expect.arrayContaining(manifestBefore));
    expect(await applyCoachingContextReconciliation(fixtureIds(), new Set())).toEqual(
      fixtureIds().map((clientId) => expect.objectContaining({ clientId, changed: false }))
    );
    expect(await contextRows(fixtureIds())).toEqual(before);
  }, 60_000);

  it("D3 dry run reports the same counts an apply writes, and writes nothing", async () => {
    const dry = await reattributeMessageCoach({ apply: false, manifestClientIds: manifestIds() });
    expect(dry.excludedManifestClients).toBeGreaterThanOrEqual(6);
    expect(dry.excludedEvidenceClients).toBeGreaterThanOrEqual(2);
    expect(dry.applied).toBe(false);
    expect(dry.senderAttributed).toBeGreaterThanOrEqual(1); // X->okHuman (twoCoaches, ambiguous, overlap are excluded)
    expect(dry.singleCoachAttributed).toBeGreaterThanOrEqual(2); // okHuman reply, noneCoached reply
    for (const id of Object.values(msgs)) expect(await coachIdOf(id)).toBeNull();

    const cli = runCli("reattribute-message-coach.ts", [`--manifest=${manifestFile}`]);
    expect(cli.status, cli.out).toBe(0);
    expect(cli.out).toContain(`step 1, coach-sent rows (coachId = senderId):          ${dry.senderAttributed}`);
    expect(cli.out).toContain(`step 2, single-coach rows (T-661 backfill, pinned):    ${dry.singleCoachAttributed}`);
    for (const id of Object.values(msgs)) expect(await coachIdOf(id)).toBeNull();

    const res = runCli("reattribute-message-coach.ts", [`--manifest=${manifestFile}`, "--apply", `--confirm-db=${confirmKey()}`]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain(`step 1, coach-sent rows (coachId = senderId):          ${dry.senderAttributed}`);
    expect(res.out).toContain(`step 2, single-coach rows (T-661 backfill, pinned):    ${dry.singleCoachAttributed}`);
    expect(res.out).toContain(`excluded: overlap risk (manifest):                     ${dry.unattributed.excludedOverlapRisk}`);
  }, 60_000);

  it("D3 attributes single-coach history and never guesses for a client who has had more than one coach", async () => {
    expect(await coachIdOf(msgs.singleCoachSent)).toBe(coaches.X.id);
    expect(await coachIdOf(msgs.singleClientReply)).toBe(coaches.X.id);
    expect(await coachIdOf(msgs.singleBeforeRow)).toBeNull(); // predates the relationship row
    // Two coaches: X wrote after Y's row existed, so the client is excluded entirely (other-coach evidence).
    expect(await coachIdOf(msgs.otherCoachSent)).toBeNull();
    expect(await coachIdOf(msgs.twoCoachesReply)).toBeNull();
    expect(await coachIdOf(msgs.ambiguousCoachSent)).toBeNull(); // 2 CoachClient rows: in the manifest, excluded
    expect(await coachIdOf(msgs.ambiguousReply)).toBeNull(); // 2 CoachClient rows
    expect(await coachIdOf(msgs.staleReply)).toBe(coaches.A.id); // only possible after D1
  });

  it("OVERLAP: a reply written to coach Q never gets coachId P; the excluded client stays NULL entirely", async () => {
    expect(await coachIdOf(msgs.overlapReplyToQ)).toBeNull();
    expect(await coachIdOf(msgs.overlapReplyToQ)).not.toBe(coaches.P.id);
    expect(await coachIdOf(msgs.overlapBReplyToQ)).toBeNull();
    expect(await coachIdOf(msgs.overlapPSent)).toBeNull(); // excluded from step 1 too (lead decision)
    expect(await coachIdOf(msgs.evidenceUploadReply)).toBeNull();
    expect(await coachIdOf(msgs.evidenceInviteReply)).toBeNull();
  });

  it("refuses when _prisma_migrations does not carry the pinned T-661 checksum", async () => {
    const name = "20260915000000_message_coach_backfill_single_coach";
    await db.$executeRaw`UPDATE "_prisma_migrations" SET checksum = 'tampered' WHERE migration_name = ${name}`;
    try {
      await expect(reattributeMessageCoach({ apply: false, manifestClientIds: manifestIds() })).rejects.toThrow(/expected dca2dae9/);
    } finally {
      await db.$executeRaw`UPDATE "_prisma_migrations" SET checksum = ${PINNED_T661_SHA256} WHERE migration_name = ${name}`;
    }
  });

  it("D3 --apply is one-shot: a second apply is refused, a dry run still reports 0 to write", async () => {
    expect(readOverlapManifest(manifestFile, confirmKey()).d3AppliedAt).toBeTruthy();
    const second = runCli("reattribute-message-coach.ts", [`--manifest=${manifestFile}`, "--apply", `--confirm-db=${confirmKey()}`]);
    expect(second.status, second.out).toBe(2);
    expect(second.out).toContain("D3 --apply is one-shot per deploy and has already run; refusing.");
    const dry = runCli("reattribute-message-coach.ts", [`--manifest=${manifestFile}`]);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toContain("step 1, coach-sent rows (coachId = senderId):          0");
    expect(dry.out).toContain("step 2, single-coach rows (T-661 backfill, pinned):    0");
    expect(dry.out).toMatch(/COULD NOT ATTRIBUTE \(coachId stays NULL, after a would-be apply\): \d+/);
    const again = await reattributeMessageCoach({ apply: false, manifestClientIds: manifestIds() });
    expect(again.senderAttributed + again.singleCoachAttributed).toBe(0);
    expect(again.unattributed.excludedOverlapRisk).toBeGreaterThanOrEqual(3);
    expect(again.unattributed.excludedOtherCoachEvidence).toBeGreaterThanOrEqual(2);
    expect(again.unattributed.singleCoachBeforeRelationshipRow).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("review r2 RUN1/RUN2 reproduction: a fresh run dir cannot re-expose cleared clients; both overlap replies stay NULL", async () => {
    const run2 = mkdtempSync(path.join(os.tmpdir(), "t2059-run2-"));
    try {
      const d1 = runCli("reconcile-coaching-context.ts", ["--apply", `--confirm-db=${confirmKey()}`, `--run-dir=${run2}`]);
      expect(d1.status, d1.out).toBe(2);
      expect(d1.out).toContain("No overlap manifest at");
      const d3 = runCli("reattribute-message-coach.ts", [`--manifest=${manifestPathFor(run2)}`, "--apply", `--confirm-db=${confirmKey()}`]);
      expect(d3.status, d3.out).toBe(2);
      expect(d3.out).toContain("Overlap manifest not found");
      const d3run1 = runCli("reattribute-message-coach.ts", [`--manifest=${manifestFile}`, "--apply", `--confirm-db=${confirmKey()}`]);
      expect(d3run1.status, d3run1.out).toBe(2);
    } finally {
      rmSync(run2, { recursive: true, force: true });
    }
    expect(await coachIdOf(msgs.overlapReplyToQ)).toBeNull();
    expect(await coachIdOf(msgs.overlapBReplyToQ)).toBeNull();
  }, 60_000);
});
