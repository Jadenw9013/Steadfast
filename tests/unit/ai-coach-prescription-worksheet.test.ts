import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESCRIPTION_PARAMETER_SPECS } from "@/lib/ai-coach/prescription/parameters";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";

/**
 * S-23 — `steadfast-hq/board/DOSE-WORKSHEET-3.md` is a contract, so it is
 * checked against the code that enforces it.
 *
 * Two worksheets in a row were counted by pattern-matching over source files
 * and both were wrong: one listed 23 parameters when the resolver wanted 18
 * doses it had never mentioned, and one swept unit strings in as if they were
 * parameter ids. Nobody noticed until a harness run, because a worksheet is
 * prose and prose does not fail.
 *
 * This test makes that mechanical. It parses the worksheet and asserts its id
 * list is exactly the set of `PRESCRIPTION_PARAMETER_SPECS` entries the signed
 * policy bundle does not yet carry — the same array `resolvePrescriptionParameters`
 * walks when it decides to refuse — and that every unit printed beside a blank
 * is the unit the resolver will require for it.
 *
 * Set equality in both directions is the point. A parameter the resolver needs
 * and the worksheet omits fails here, and so does a worksheet row for something
 * already signed, which is what keeps the sheet shrinking as values land rather
 * than quietly asking for a value twice.
 */

/** `ID   ______   UNIT`. Anchored at column 0, so indented prose cannot match. */
const WORKSHEET_ROW = /^([A-Z][A-Z0-9_.]*)[ \t]+_{3,}[ \t]+([A-Z][A-Z0-9_]*)[ \t]*$/gm;

const WORKSHEET_RELATIVE_PATH = "board/DOSE-WORKSHEET-3.md";

function worksheetPath(): string {
  const hq =
    process.env.STEADFAST_HQ ?? path.resolve(process.cwd(), "..", "steadfast-hq");
  return path.join(hq, WORKSHEET_RELATIVE_PATH);
}

function readWorksheet(): string {
  const file = worksheetPath();
  if (!fs.existsSync(file)) {
    // Deliberately loud and deliberately specific: this is an environment
    // problem, not a drift finding. The board repo is a sibling checkout on
    // the machine the gates run on; set STEADFAST_HQ if it lives elsewhere.
    throw new Error(
      `ENVIRONMENT, NOT DRIFT: the worksheet was not found at ${file}. ` +
        `This test compares steadfast-hq's ${WORKSHEET_RELATIVE_PATH} against the ` +
        `prescription resolver; it cannot run without the board checkout. ` +
        `Set STEADFAST_HQ to the steadfast-hq path and re-run.`
    );
  }
  return fs.readFileSync(file, "utf8");
}

/** The ids the resolver requires and the signed bundle does not carry. */
function requiredButUnsigned() {
  const present = new Set(
    loadDraftUnsignedPolicyBundle().content.numericParameters.map((item) => item.id)
  );
  return PRESCRIPTION_PARAMETER_SPECS.filter((spec) => !present.has(spec.id));
}

describe("S-23 — DOSE-WORKSHEET-3 agrees with the prescription resolver", () => {
  it("lists exactly the parameter ids the resolver requires and the bundle lacks", () => {
    const text = readWorksheet();
    const parsed = [...text.matchAll(WORKSHEET_ROW)].map((match) => match[1]);
    const required = requiredButUnsigned().map((spec) => spec.id);

    // A worksheet that parsed to nothing would pass a one-directional check.
    expect(parsed.length).toBeGreaterThan(0);
    expect(new Set(parsed).size).toBe(parsed.length);

    expect([...parsed].sort()).toEqual([...required].sort());
  });

  it("prints the resolver's unit beside every blank", () => {
    // The specific mistake that produced the last bad count was a unit string
    // being read as an id. Pinning the pairing catches it from both sides.
    const text = readWorksheet();
    const parsed = new Map([...text.matchAll(WORKSHEET_ROW)].map((m) => [m[1], m[2]]));
    for (const spec of requiredButUnsigned()) {
      expect({ id: spec.id, unit: parsed.get(spec.id) }).toEqual({
        id: spec.id,
        unit: spec.unit,
      });
    }
  });

  it("does not offer a value for anything, and leaves every blank blank", () => {
    // A worksheet that arrives pre-filled is a recommendation wearing a
    // worksheet's clothes, which is how the last set of doses reached the
    // board already carrying the test fixture's numbers.
    const text = readWorksheet();
    const filled = /^([A-Z][A-Z0-9_.]*)[ \t]+(-?\d[\d.]*)[ \t]+/gm;
    expect([...text.matchAll(filled)].map((match) => match[1])).toEqual([]);
    expect([...text.matchAll(WORKSHEET_ROW)]).toHaveLength(requiredButUnsigned().length);
  });

  it("quotes the safety-floor hook names the bundle actually carries", () => {
    // Section C tells the reader to repoint two hooks. If the bundle's hook
    // names change and the sheet keeps quoting the old ones, the instruction
    // becomes wrong in the most dangerous place on the sheet.
    const text = readWorksheet();
    const limits = loadDraftUnsignedPolicyBundle().content.safetyControls.nutritionLimits;
    for (const hook of [
      limits.minimumDailyEnergyParameterId,
      limits.maximumWeeklyLossRateParameterId,
      limits.minimumDailyEnergyRuleId,
      limits.maximumWeeklyLossRateRuleId,
    ]) {
      expect({ hook, quoted: text.includes(hook) }).toEqual({ hook, quoted: true });
    }
  });
});
