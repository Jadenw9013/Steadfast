import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  extractT661Statement,
  PINNED_T661_SHA256,
  readPinnedT661Statement,
  sha256,
} from "@/lib/maintenance/message-coach-reattribution";

/**
 * T-2059 r2 (review r1 finding 2): the D3 script runs the T-661 body through
 * pg's simple query protocol, so the file is pinned by sha256 and the extracted
 * body is anchored and keyword-checked. These cases are the reviewer's two
 * tampering shapes plus the anchor.
 */
const FILE = path.join(process.cwd(), "prisma/migrations/20260915000000_message_coach_backfill_single_coach/migration.sql");
const shipped = readFileSync(FILE, "utf8");
const START = "-- >>> T-661 BACKFILL — executed verbatim by tests/integration/message-coach-backfill.test.ts >>>";

describe("T-2059 T-661 pin", () => {
  it("the shipped file matches the pin and the baseline manifest, and extracts one anchored UPDATE", () => {
    expect(sha256(shipped)).toBe(PINNED_T661_SHA256);
    const statement = readPinnedT661Statement();
    expect(statement.startsWith("WITH sole_relationship AS (")).toBe(true);
    expect(statement).toContain('UPDATE "Message" m');
    expect(statement).not.toContain(";");
  });

  it("rejects a COMMIT smuggled onto one line", () => {
    const tampered = shipped.replace('UPDATE "Message" m', 'SELECT 1 FROM attribution_window; COMMIT; UPDATE "Message" m');
    expect(() => extractT661Statement(tampered)).toThrow(/more than one statement|forbidden/);
  });

  it("rejects a data-modifying DELETE CTE", () => {
    const tampered = shipped.replace("WITH sole_relationship AS (", 'WITH gone AS (DELETE FROM "Message" RETURNING 1), sole_relationship AS (');
    expect(() => extractT661Statement(tampered)).toThrow(/WITH sole_relationship|forbidden/);
    const inner = shipped.replace("unambiguous_relationship AS (", 'gone AS (DELETE FROM "Message" RETURNING 1), unambiguous_relationship AS (');
    expect(() => extractT661Statement(inner)).toThrow(/forbidden/);
  });

  it("rejects DROP / TRUNCATE / ALTER / ROLLBACK anywhere in the body, but not in comments", () => {
    for (const word of ["DROP", "TRUNCATE", "ALTER", "ROLLBACK"]) {
      const tampered = shipped.replace('AND m."coachId"   IS NULL', `AND m."coachId"   IS NULL AND '${word}' <> ''`);
      expect(tampered).not.toBe(shipped);
      expect(() => extractT661Statement(tampered), word).toThrow(/forbidden/);
    }
    const commented = shipped.replace(START, `${START}\n-- DROP everything (comment only)`);
    expect(commented).not.toBe(shipped);
    expect(() => extractT661Statement(commented)).not.toThrow();
  });

  it("rejects a body that no longer starts with WITH sole_relationship", () => {
    const tampered = shipped.replace("WITH sole_relationship AS (", "WITH other_name AS (");
    expect(() => extractT661Statement(tampered)).toThrow(/WITH sole_relationship/);
  });

  it("a one-byte change to the file fails the sha256 pin", () => {
    expect(sha256(`${shipped} `)).not.toBe(PINNED_T661_SHA256);
  });
});
