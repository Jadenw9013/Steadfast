import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildSyntheticPrescriptionBundle,
  buildSyntheticExplanationTexts,
  buildSyntheticSafetyFloors,
  corruptPrescriptionParameter,
} from "../helpers/ai-prescription-bundle";
import { resolvePrescriptionParameters } from "@/lib/ai-coach/prescription/parameters";
import { computePrescription } from "@/lib/ai-coach/prescription/index";
import type { PrescriptionInput } from "@/lib/ai-coach/prescription/types";

/**
 * T-2032 — reads tests/fixtures/ai-coach/prescription-vectors.json, a
 * checked-in, RD-signable table of synthetic {id, bundleOverrides, input,
 * expected} rows. See the fixture's own header comment: SYNTHETIC FIXTURE
 * VALUES, NOT APPROVED GUIDANCE, re-signed when real values land (D03-T01).
 */

type VectorRow = {
  id: string;
  bundleOverrides: { id: string; value: number }[];
  safetyFloorOverrides: Record<string, number> | null;
  explanationTexts: string[] | null;
  input: PrescriptionInput;
  expected: {
    status: "PRESCRIBED" | "UNAVAILABLE";
    reasonCodes: string[];
    prescription: Record<string, unknown> | null;
  };
};

const fixturePath = path.join(
  __dirname,
  "..",
  "fixtures",
  "ai-coach",
  "prescription-vectors.json"
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { vectors: VectorRow[] };

/**
 * Every field of `Prescription` except `parameterSetDigest` (a content hash,
 * not hand-checkable) and `assumptions` (reviewed copy, not numeric) — a
 * PRESCRIBED row must assert all of them. T-2032 review r1 finding B1 hid
 * inside a vector that asserted only `targetEnergyKcal`/`appliedBoundIds`;
 * finding m11 is the same root cause generalized: a thin row proves almost
 * nothing.
 */
const REQUIRED_PRESCRIPTION_KEYS = [
  "appliedBoundIds",
  "carbohydrateRangeG",
  "energyMethodStructureId",
  "fatRangeG",
  "maintenanceEnergyKcal",
  "method",
  "projectedWeeklyWeightChangeKg",
  "proteinG",
  "targetEnergyKcal",
  "tolerancePercent",
].sort();

describe("prescription vectors (synthetic fixture)", () => {
  it("every PRESCRIBED row asserts the full prescription, not a subset", () => {
    for (const row of fixture.vectors) {
      if (row.expected.status !== "PRESCRIBED") continue;
      expect(row.expected.prescription).not.toBeNull();
      if (!row.expected.prescription) continue;
      expect(Object.keys(row.expected.prescription).sort()).toEqual(REQUIRED_PRESCRIPTION_KEYS);
    }
  });

  it.each(fixture.vectors)("$id", (row) => {
    let bundle = buildSyntheticPrescriptionBundle();
    for (const override of row.bundleOverrides) {
      bundle = corruptPrescriptionParameter(bundle, override.id, (p) => ({ ...p, value: override.value }));
    }
    const floors = { ...buildSyntheticSafetyFloors(), ...(row.safetyFloorOverrides ?? {}) };
    const explanationTexts = row.explanationTexts ?? buildSyntheticExplanationTexts();

    const resolved = resolvePrescriptionParameters(bundle, explanationTexts, floors);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const result = computePrescription(resolved.parameters, row.input);
    expect(result.status).toBe(row.expected.status);
    expect(result.reasonCodes).toEqual(row.expected.reasonCodes);

    if (row.expected.prescription === null) {
      expect(result.prescription).toBeNull();
      return;
    }
    expect(result.prescription).not.toBeNull();
    if (!result.prescription) return;
    for (const [key, value] of Object.entries(row.expected.prescription)) {
      expect(result.prescription).toHaveProperty(key);
      expect((result.prescription as Record<string, unknown>)[key]).toEqual(value);
    }
  });
});
