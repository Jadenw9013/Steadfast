import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { intakeV2ConfirmSchema } from "@/lib/ai-coach/intake";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function fixture() {
  return JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/ai-coach/intake-v2-confirm-v1.json"), "utf8"));
}

// Frozen key list (parent contract T-2002, "intakeV2ConfirmSchema required
// set"). Any field added, removed or renamed on either platform must fail
// this test.
const FROZEN_KEYS = [
  "ageStatus",
  "ageYears",
  "allergenDeclarations",
  "bodyMeasurementStatus",
  "bodyWeightIntent",
  "cookingAccess",
  "cookingAccessStatus",
  "cuisinePreferences",
  "dietaryPattern",
  "dislikes",
  "energyMethodPopulationCategory",
  "energyMethodPopulationCategoryStatus",
  "equipmentAccess",
  "experienceLevel",
  "foodBudgetLevel",
  "goal",
  "goalPaceClass",
  "goalStatus",
  "heightCm",
  "intakeVersion",
  "physicalActivityCategory",
  "physicalActivityCategoryStatus",
  "resistanceTrainingContext",
  "sessionLengthBand",
  "trackingPreference",
  "trainingContextStatus",
  "trainingDaysPerWeek",
  "unitsPreference",
  "weightKg",
  "weightMeasuredOn",
  "weightNeutralAccepted",
].sort();

describe("T-2002/T-2024 intake v2 golden contract fixture", () => {
  it("parses under intakeV2ConfirmSchema", () => {
    const result = intakeV2ConfirmSchema.safeParse(fixture());
    expect(result.success).toBe(true);
  });

  it("has exactly the frozen key set — any drift on either platform fails here", () => {
    expect(Object.keys(fixture()).sort()).toEqual(FROZEN_KEYS);
  });

  it("lib/ai-coach/intake.ts, lib/ai-coach/intake-contract.ts and lib/ai-coach/client-commands.ts never reference gender", () => {
    expect(source("lib/ai-coach/intake.ts")).not.toMatch(/gender/i);
    expect(source("lib/ai-coach/intake-contract.ts")).not.toMatch(/gender/i);
    expect(source("lib/ai-coach/client-commands.ts")).not.toMatch(/gender/i);
  });

  // T-2024 review round 4 — the regression guard for the production-build
  // defect QA caught: `intake-wizard.tsx` (a `"use client"` component)
  // must never import from `lib/ai-coach/intake.ts` again (that module
  // imports `db`/`pg`, and Next.js bundles by module, not by tree-shaken
  // export — a single value import from it would pull `pg`'s Node-only
  // internals back into the browser bundle), and the leaf contract module
  // it does import must stay free of any server-only import. This test
  // would have failed on the pre-fix (round 3) state.
  it("components/ai-coach/intake-wizard.tsx imports only the client-safe intake contract, never lib/ai-coach/intake", () => {
    const wizard = source("components/ai-coach/intake-wizard.tsx");
    // Anchored on `import ... from "..."` (not just any quoted mention of
    // the path — the file's own warning comment about this rule contains
    // the literal string as prose, which must not trip the check).
    expect(wizard).not.toMatch(/^\s*import[^;]*from ["']@\/lib\/ai-coach\/intake["']/m);
    expect(wizard).toContain('from "@/lib/ai-coach/intake-contract"');
  });

  it("lib/ai-coach/intake-contract.ts never imports db or the generated Prisma client", () => {
    const contract = source("lib/ai-coach/intake-contract.ts");
    expect(contract).not.toMatch(/@\/lib\/db/);
    expect(contract).not.toMatch(/generated\/prisma/);
  });
});
