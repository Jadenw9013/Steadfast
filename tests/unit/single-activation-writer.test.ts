import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COACH_SETTABLE_STAGES } from "@/lib/leads/activate-lead";

/**
 * T-978 — the single activation service.
 *
 * Static enforcement mechanism #2 of 4 (compile time / this static guard /
 * the funnel matrix / the reviewer). Before this ticket, SIX different
 * places wrote `consultationStage = 'ACTIVE'`. This test walks every `.ts`
 * and `.tsx` file under `app/` and `lib/` and fails on either write pattern
 * (a raw-SQL `SET` or a Prisma `data:` literal) unless the file is in the
 * explicit ALLOWLIST below, each entry carrying a one-line reason. Growing
 * the allowlist is the wrong fix — route the write through
 * `lib/leads/activate-lead.ts#activateLead` instead.
 */

// Raw SQL: `SET "consultationStage" = 'ACTIVE'::"ConsultationStage"`.
const RAW_SQL_ACTIVE = /"consultationStage"\s*=\s*'ACTIVE'/;
// Prisma write/filter literal: `consultationStage: "ACTIVE"`.
const PRISMA_ACTIVE = /consultationStage:\s*"ACTIVE"/;

const ALLOWLIST: Record<string, string> = {
  "lib/leads/activate-lead.ts":
    "the one writer — this file's doc comment says so and its own transaction is the enforcement boundary.",
  // T-2058 moved this entry, unchanged in kind, from
  // app/api/coach/clients/[clientId]/route.ts: the removal teardown is now one
  // shared function, so the route no longer contains the pattern.
  "lib/coach-client/end-relationship.ts":
    "a `where` clause selecting leads to move OFF ACTIVE on client removal (T-979 territory), never a write of ACTIVE — a read, not a writer.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "generated" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const root = process.cwd();
  const files = [...walk(join(root, "app")), ...walk(join(root, "lib"))];
  const violations: { file: string; pattern: string }[] = [];

  for (const absPath of files) {
    const relPath = relative(root, absPath);
    if (relPath in ALLOWLIST) continue;
    const source = readFileSync(absPath, "utf8");
    if (RAW_SQL_ACTIVE.test(source)) violations.push({ file: relPath, pattern: "raw SQL SET" });
    if (PRISMA_ACTIVE.test(source)) violations.push({ file: relPath, pattern: "Prisma write/filter literal" });
  }
  return violations;
}

describe("T-978 — single writer of consultationStage = ACTIVE", () => {
  it("no file outside the allowlist contains a write of consultationStage = ACTIVE", () => {
    const violations = scan();
    expect(
      violations,
      violations
        .map(
          (v) =>
            `${v.file} (${v.pattern}) — route the write through lib/leads/activate-lead.ts#activateLead ` +
            `instead of extending the allowlist.`
        )
        .join("\n")
    ).toEqual([]);
  });

  it("the allowlist itself is exactly the two files the spec names — a seventh entry needs a human to add it here", () => {
    expect(Object.keys(ALLOWLIST).sort()).toEqual(
      ["lib/coach-client/end-relationship.ts", "lib/leads/activate-lead.ts"].sort()
    );
    for (const reason of Object.values(ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("lib/leads/activate-lead.ts really does contain the writer pattern (the allowlist is not hiding an absent writer)", () => {
    const source = readFileSync(join(process.cwd(), "lib/leads/activate-lead.ts"), "utf8");
    expect(PRISMA_ACTIVE.test(source)).toBe(true);
  });
});

describe("T-978 — VALID_STAGE_TRANSITIONS and COACH_SETTABLE_STAGES never admit ACTIVE", () => {
  it("app/actions/coaching-requests.ts's VALID_STAGE_TRANSITIONS has no ACTIVE value", async () => {
    const source = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../app/actions/coaching-requests.ts", import.meta.url), "utf8");
    const match = source.match(/const VALID_STAGE_TRANSITIONS[^;]*?=\s*\{([\s\S]*?)\n\};/);
    expect(match, "VALID_STAGE_TRANSITIONS declaration not found").not.toBeNull();
    expect(match![1]).not.toMatch(/ACTIVE/);
  });

  it("COACH_SETTABLE_STAGES excludes ACTIVE", () => {
    expect(COACH_SETTABLE_STAGES).not.toContain("ACTIVE");
  });

  it("COACH_SETTABLE_STAGES is the type used by all four stage-editing surfaces", async () => {
    const fs = await import("node:fs/promises");
    const files = [
      "app/actions/coaching-requests.ts", // updateConsultationStage
      "app/api/coach/leads/[leadId]/route.ts", // PATCH + PUT
      "app/api/coach/leads/[leadId]/stage/route.ts", // PUT
    ];
    for (const f of files) {
      const source = await fs.readFile(new URL(`../../${f}`, import.meta.url), "utf8");
      expect(source, `${f} does not import COACH_SETTABLE_STAGES`).toMatch(/COACH_SETTABLE_STAGES/);
    }
  });
});
