import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_MIGRATIONS } from "@/lib/health/expected-migrations";

describe("health migration expectation", () => {
  it("matches the number of checked-in migration directories", () => {
    const migrationsPath = join(process.cwd(), "prisma", "migrations");
    const directoryCount = readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .length;

    expect(EXPECTED_MIGRATIONS).toBe(directoryCount);
  });
});
