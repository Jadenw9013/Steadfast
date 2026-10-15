import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T-2060 — every CoachClient create/delete writes the relationship history.
 *
 * `CoachClientEpisode` is the recorded fact that lib/coach-client/plan-visibility.ts
 * reads. It is only trustworthy if every CoachClient create opens an episode
 * and every delete closes one, in the same transaction. This static guard walks
 * every source file under `app/`, `lib/`, `scripts/` and `prisma/` (.ts, .tsx,
 * .js, .mjs, .cjs, .sql) and:
 *  - fails on any CoachClient write in a file outside the allowlist;
 *  - for each allowlisted file, requires the number of CoachClient write sites
 *    to equal the number of episode writes paired with them, so a second,
 *    unpaired write in an allowlisted file also fails.
 * Growing the allowlist is the wrong fix: route the write through
 * lib/activation.ts (create) or lib/coach-client/end-relationship.ts (delete).
 * Same style as tests/unit/single-activation-writer.test.ts. Widened after
 * review r1 (schema-qualified and quoted names, TRUNCATE, nested relation
 * writes, .js/.mjs, scripts/ and prisma/, per-site counting).
 */

// The table name, quoted or not, optionally schema-qualified, never CoachClientEpisode.
const TABLE = String.raw`(?:"?public"?\s*\.\s*)?(?:"CoachClient"|\bCoachClient\b)(?!Episode)`;

const WRITE_PATTERNS: { kind: string; re: RegExp }[] = [
  // Prisma client: `tx.coachClient.create(`, `db.coachClient\n  .deleteMany(`...
  { kind: "prisma", re: /\bcoachClient\s*\.\s*(?:create|createMany|createManyAndReturn|upsert|delete|deleteMany)\s*\(/g },
  // Nested relation writes through User.coachAssignments / User.clientAssignments.
  {
    kind: "nested",
    re: /\b(?:coach|client)Assignments\s*:\s*\{[^}]*?\b(?:create|createMany|connectOrCreate|upsert|delete|deleteMany|set|connect|disconnect)\b/g,
  },
  { kind: "raw INSERT", re: new RegExp(String.raw`INSERT\s+INTO\s+${TABLE}`, "gi") },
  { kind: "raw DELETE", re: new RegExp(String.raw`DELETE\s+FROM\s+(?:ONLY\s+)?${TABLE}`, "gi") },
  { kind: "TRUNCATE", re: new RegExp(String.raw`TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?[^;\`]*?${TABLE}`, "gi") },
];

type Entry = {
  /** What pairs each CoachClient write site in this file with its episode write. */
  pair: RegExp;
  reason: string;
};

/** file -> how each of its CoachClient write sites is paired with an episode write. */
const ALLOWLIST: Record<string, Entry> = {
  "lib/activation.ts": {
    pair: /await\s+openCoachClientEpisode\s*\(/g,
    reason: "the one create (acceptance); opens the episode in the same tx",
  },
  "lib/coach-client/end-relationship.ts": {
    pair: /await\s+closeCoachClientEpisode\s*\(/g,
    reason: "the one teardown; closes the episode in the same tx",
  },
  "lib/account-deletion/purge.ts": {
    pair: /UPDATE\s+"CoachClientEpisode"/g,
    reason: "account purge; closes + anonymises the coach's episodes before the raw delete, same tx",
  },
  "scripts/purge-now.mjs": {
    pair: /UPDATE\s+"CoachClientEpisode"/g,
    reason: "one-off purge script; closes the coach's episodes before the delete, same tx",
  },
  "prisma/seed.ts": {
    pair: /(?!)/g, // matches nothing: 0 episode writes
    reason: "DOCUMENTED EXCEPTION: dev seed upsert writes no episode; the rule falls back to the strict bound",
  },
};
/** Allowlisted files whose write count must equal 0 paired writes (exceptions). */
const UNPAIRED_EXCEPTIONS = new Set(["prisma/seed.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["generated", "node_modules", "migrations", "baselines"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:tsx?|m?js|cjs|sql)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function countWrites(source: string): { total: number; kinds: string[] } {
  const kinds: string[] = [];
  for (const { kind, re } of WRITE_PATTERNS) {
    for (const _ of source.matchAll(re)) kinds.push(kind);
  }
  return { total: kinds.length, kinds };
}

const count = (source: string, re: RegExp) => [...source.matchAll(re)].length;

function scan() {
  const root = process.cwd();
  const files = ["app", "lib", "scripts", "prisma"].flatMap((d) => walk(join(root, d)));
  return files
    .map((abs) => ({ file: relative(root, abs), source: readFileSync(abs, "utf8") }))
    .map((f) => ({ ...f, writes: countWrites(f.source) }))
    .filter((f) => f.writes.total > 0);
}

describe("T-2060 — CoachClient writers also write CoachClientEpisode", () => {
  it("no file outside the allowlist writes CoachClient", () => {
    const violations = scan().filter((w) => !(w.file in ALLOWLIST));
    expect(
      violations.map((v) => `${v.file} (${v.writes.kinds.join(", ")})`),
      "create through lib/activation.ts or delete through lib/coach-client/end-relationship.ts so the " +
        "CoachClientEpisode is written in the same transaction",
    ).toEqual([]);
  });

  it("the allowlist is exactly the current writers (no stale entries)", () => {
    expect(scan().map((w) => w.file).sort()).toEqual(Object.keys(ALLOWLIST).sort());
  });

  it.each(Object.entries(ALLOWLIST))("%s pairs every CoachClient write site with an episode write", (file, entry) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const writes = countWrites(source).total;
    const paired = count(source, entry.pair);
    expect(writes, `${file}: no CoachClient write found; drop it from the allowlist`).toBeGreaterThan(0);
    if (UNPAIRED_EXCEPTIONS.has(file)) {
      expect(paired, entry.reason).toBe(0);
      expect(writes, `${file}: a new write in a documented exception`).toBe(1);
    } else {
      expect(paired, `${file}: ${writes} CoachClient write site(s) but ${paired} episode write(s) (${entry.reason})`).toBe(writes);
    }
  });

  it("the purge paths write the 'purged' author sentinel, never NULL (review r1)", () => {
    const purge = readFileSync(join(process.cwd(), "lib/account-deletion/purge.ts"), "utf8");
    const purgeNow = readFileSync(join(process.cwd(), "scripts/purge-now.mjs"), "utf8");
    expect(count(purge, /SET "publishedByCoachId" = \$\{PURGED_PUBLISHER_ID\}/g)).toBe(2);
    expect(count(purgeNow, /SET "publishedByCoachId" = 'purged'/g)).toBe(2);
    for (const src of [purge, purgeNow]) expect(src).not.toMatch(/"publishedByCoachId" = NULL/);
  });

  it("the patterns catch every write shape (self-test)", () => {
    const n = (s: string) => countWrites(s).total;
    expect(n("await tx.coachClient.create({ data })")).toBe(1);
    expect(n("db.coachClient.deleteMany({ where })")).toBe(1);
    expect(n("prisma.coachClient.upsert({})")).toBe(1);
    expect(n("tx.coachClient\n  .delete({ where })")).toBe(1);
    expect(n('tx.$executeRaw`INSERT INTO "CoachClient" ("id") VALUES (1)`')).toBe(1);
    expect(n('tx.$executeRaw`DELETE FROM "CoachClient" WHERE 1`')).toBe(1);
    expect(n('DELETE FROM public."CoachClient" WHERE 1')).toBe(1);
    expect(n('INSERT INTO "public"."CoachClient" ("id")')).toBe(1);
    expect(n('DELETE FROM ONLY "CoachClient"')).toBe(1);
    expect(n('TRUNCATE "CoachClient" CASCADE')).toBe(1);
    expect(n('TRUNCATE TABLE "User", public."CoachClient"')).toBe(1);
    expect(n("db.user.update({ where, data: { clientAssignments: { create: { coachId } } } })")).toBe(1);
    expect(n("db.user.update({ data: { coachAssignments: { deleteMany: {} } } })")).toBe(1);
    expect(n("data: { clientAssignments: { connectOrCreate: x } }")).toBe(1);
    // Two sites in one file count twice.
    expect(n("tx.coachClient.create({}); tx.coachClient.create({});")).toBe(2);
    // Reads and the episode table itself are not CoachClient writes.
    expect(n("db.coachClient.findMany({ select })")).toBe(0);
    expect(n("include: { clientAssignments: { select: { id: true } } }")).toBe(0);
    expect(n('DELETE FROM "CoachClientEpisode" WHERE 1')).toBe(0);
    expect(n('INSERT INTO "CoachClientEpisode" ("id")')).toBe(0);
    expect(n('TRUNCATE "CoachClientEpisode"')).toBe(0);
    expect(n('SELECT 1 FROM "CoachClient" cc')).toBe(0);
  });
});
