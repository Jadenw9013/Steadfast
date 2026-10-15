import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T-2060 — every CoachClient create/delete writes the relationship history.
 *
 * `CoachClientEpisode` is the recorded fact that lib/coach-client/plan-visibility.ts
 * reads. It is only trustworthy if every CoachClient create opens an episode
 * and every delete closes one, in the same transaction. This static guard walks
 * every `.ts`/`.tsx` file under `app/` and `lib/` and fails on a CoachClient
 * write outside the allowlist below, and fails if an allowlisted file stops
 * writing the episode. Growing the allowlist is the wrong fix: route the write
 * through lib/activation.ts (create) or lib/coach-client/end-relationship.ts
 * (delete) instead. Same style as tests/unit/single-activation-writer.test.ts.
 */

// Prisma client writes: `tx.coachClient.create(`, `db.coachClient.deleteMany(`...
const PRISMA_WRITE = /\bcoachClient\s*\.\s*(create|createMany|createManyAndReturn|upsert|delete|deleteMany)\s*\(/;
// Raw SQL writes.
const RAW_INSERT = /INSERT\s+INTO\s+"CoachClient"\s*[("\s]/i;
const RAW_DELETE = /DELETE\s+FROM\s+"CoachClient"(?!\w)/i;

/** file -> the token proving it writes the episode alongside the row. */
const ALLOWLIST: Record<string, string> = {
  "lib/activation.ts": "openCoachClientEpisode",
  "lib/coach-client/end-relationship.ts": "closeCoachClientEpisode",
  "lib/account-deletion/purge.ts": '"CoachClientEpisode"',
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

function findCoachClientWrites(source: string): string[] {
  const hits: string[] = [];
  if (PRISMA_WRITE.test(source)) hits.push("Prisma coachClient write");
  if (RAW_INSERT.test(source)) hits.push('raw INSERT INTO "CoachClient"');
  if (RAW_DELETE.test(source)) hits.push('raw DELETE FROM "CoachClient"');
  return hits;
}

function scan() {
  const root = process.cwd();
  const files = [...walk(join(root, "app")), ...walk(join(root, "lib"))];
  const writers: { file: string; patterns: string[] }[] = [];
  for (const absPath of files) {
    const relPath = relative(root, absPath);
    const patterns = findCoachClientWrites(readFileSync(absPath, "utf8"));
    if (patterns.length > 0) writers.push({ file: relPath, patterns });
  }
  return writers;
}

describe("T-2060 — CoachClient writers also write CoachClientEpisode", () => {
  it("no file outside the allowlist writes CoachClient", () => {
    const violations = scan().filter((w) => !(w.file in ALLOWLIST));
    expect(
      violations,
      violations
        .map(
          (v) =>
            `${v.file} (${v.patterns.join(", ")}) — create through lib/activation.ts or delete through ` +
            `lib/coach-client/end-relationship.ts so the CoachClientEpisode is written in the same transaction`,
        )
        .join("\n"),
    ).toEqual([]);
  });

  it("the allowlist is exactly the current writers (no stale entries)", () => {
    const writerFiles = scan()
      .map((w) => w.file)
      .sort();
    expect(writerFiles).toEqual(Object.keys(ALLOWLIST).sort());
  });

  it.each(Object.entries(ALLOWLIST))("%s also writes the episode (%s)", (file, token) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source.includes(token), `${file} writes CoachClient but no longer contains ${token}`).toBe(true);
  });

  it("the patterns catch every write shape (self-test)", () => {
    expect(findCoachClientWrites("await tx.coachClient.create({ data })")).toHaveLength(1);
    expect(findCoachClientWrites("db.coachClient.deleteMany({ where })")).toHaveLength(1);
    expect(findCoachClientWrites("prisma.coachClient.upsert({})")).toHaveLength(1);
    expect(findCoachClientWrites("tx.coachClient\n  .delete({ where })")).toHaveLength(1);
    expect(findCoachClientWrites('tx.$executeRaw`INSERT INTO "CoachClient" ("id") VALUES (1)`')).toHaveLength(1);
    expect(findCoachClientWrites('tx.$executeRaw`DELETE FROM "CoachClient" WHERE 1`')).toHaveLength(1);
    // Reads and the episode table itself are not CoachClient writes.
    expect(findCoachClientWrites("db.coachClient.findMany({ select })")).toEqual([]);
    expect(findCoachClientWrites('DELETE FROM "CoachClientEpisode" WHERE 1')).toEqual([]);
    expect(findCoachClientWrites('INSERT INTO "CoachClientEpisode" ("id")')).toEqual([]);
  });
});
