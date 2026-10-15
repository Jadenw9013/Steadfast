import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESCRIPTION_PARAMETER_SPECS } from "@/lib/ai-coach/prescription/parameters";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";

/**
 * S-23/S-25 — `steadfast-hq/board/DOSE-WORKSHEET-3.md` is a contract, so it is
 * checked against the code that enforces it.
 *
 * Two worksheets in a row were counted by pattern-matching over source files
 * and both were wrong: one listed 23 parameters when the resolver wanted 18
 * doses it had never mentioned, and one swept unit strings in as if they were
 * parameter ids. Nobody noticed until a harness run, because a worksheet is
 * prose and prose does not fail.
 *
 * S-23 made that mechanical while the sheet was an outstanding ask: its blank
 * rows had to be exactly the `PRESCRIPTION_PARAMETER_SPECS` entries the signed
 * bundle lacked, with the resolver's unit beside each blank.
 *
 * S-25 ingested the values, which turns that assertion inside out. The sheet
 * asks for nothing now, so the outstanding set is empty on both sides — and an
 * empty set is exactly the state the old "the sheet parsed to something" guard
 * was written to reject, because while an ask was outstanding a sheet that
 * parsed to nothing would have passed a one-directional check. The guard is
 * kept and keyed to whether anything is in fact outstanding, so re-opening the
 * sheet re-arms it, and three checks replace what it used to cover:
 *
 *  1. nothing the resolver requires is missing from the bundle (the ingestion
 *     is complete, which is what a reader of this sheet needs to know);
 *  2. every supplied row still prints the unit the resolver requires, and the
 *     supplied set is exactly the prescription parameters the bundle sources
 *     from the owner-adoption claim — derived from the artifact, never a
 *     hand-kept list;
 *  3. the sheet's provenance sentence is byte-identical to the one on every
 *     one of those parameters' provenance rows.
 */

/** `ID   ______   UNIT` — a value this sheet is still asking for. */
const OUTSTANDING_ROW = /^([A-Z][A-Z0-9_.]*)[ \t]+_{3,}[ \t]+([A-Z][A-Z0-9_]*)[ \t]*$/gm;
/** `ID   (supplied)   UNIT` — a value that has been ingested. */
const SUPPLIED_ROW = /^([A-Z][A-Z0-9_.]*)[ \t]+\(supplied\)[ \t]+([A-Z][A-Z0-9_]*)[ \t]*$/gm;

const OWNER_ADOPTION_CLAIM_ID = "CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION";
const OWNER_PROVENANCE_SENTENCE =
  "proposed by engineering, adopted by me, without claiming external literature sources.";

const WORKSHEET_RELATIVE_PATH = "board/DOSE-WORKSHEET-3.md";

/** `STEADFAST_HQ` wins. Otherwise try the known sibling layouts, newest first:
 * `~/Dev/steadfast/{web,hq}` since the 2026-09-29 consolidation, and the older
 * `~/Dev/{Steadfast,steadfast-hq}` so a checkout that predates it still runs.
 * A worktree under `~/Dev/steadfast/wt/<ticket>` is one level deeper, hence the
 * `../..` candidate. */
function worksheetPath(): string {
  if (process.env.STEADFAST_HQ) {
    return path.join(process.env.STEADFAST_HQ, WORKSHEET_RELATIVE_PATH);
  }
  const candidates = [
    path.resolve(process.cwd(), "..", "hq"),
    path.resolve(process.cwd(), "..", "..", "hq"),
    path.resolve(process.cwd(), "..", "steadfast-hq"),
  ];
  const found = candidates.find((hq) => fs.existsSync(path.join(hq, WORKSHEET_RELATIVE_PATH)));
  return path.join(found ?? candidates[0], WORKSHEET_RELATIVE_PATH);
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

/**
 * The prescription parameters the bundle itself says came from the owner
 * adoption rather than a cited source. Derived from `proposalProvenance`, so it
 * cannot drift from the artifact the way a list written here would.
 */
function ownerAdoptedPrescriptionIds(): string[] {
  const file = loadDraftUnsignedPolicyBundle();
  if (file.reviewMetadata.decision !== "APPROVED") throw new Error("bundle is not signed");
  const specIds = new Set(PRESCRIPTION_PARAMETER_SPECS.map((spec) => spec.id));
  return (file.reviewMetadata.proposalProvenance ?? [])
    .filter((row) => row.sourceClaimId === OWNER_ADOPTION_CLAIM_ID)
    .map((row) => row.parameterId)
    .filter((id) => specIds.has(id));
}

describe("S-25 — DOSE-WORKSHEET-3 agrees with the prescription resolver", () => {
  it("has nothing outstanding, because the resolver is missing nothing", () => {
    const text = readWorksheet();
    const outstanding = [...text.matchAll(OUTSTANDING_ROW)].map((match) => match[1]);
    const required = requiredButUnsigned().map((spec) => spec.id);

    // The ingestion-complete check, stated as the thing a reader cares about.
    expect({ missingFromBundle: required }).toEqual({ missingFromBundle: [] });

    // Set equality in both directions, as before. A parameter the resolver
    // needs and the sheet omits fails here, and so does a sheet row for
    // something already signed.
    expect([...outstanding].sort()).toEqual([...required].sort());

    // The original guard, re-armed: while anything is outstanding the sheet
    // must list it, so a sheet that parsed to nothing cannot pass.
    if (required.length > 0) expect(outstanding.length).toBeGreaterThan(0);
    expect(new Set(outstanding).size).toBe(outstanding.length);
  });

  it("prints the resolver's unit beside every value it supplied", () => {
    // The specific mistake that produced the last bad count was a unit string
    // being read as an id. Pinning the pairing catches it from both sides.
    const text = readWorksheet();
    const supplied = new Map([...text.matchAll(SUPPLIED_ROW)].map((m) => [m[1], m[2]]));
    const adopted = ownerAdoptedPrescriptionIds();

    expect(adopted).toHaveLength(13);
    expect([...supplied.keys()].sort()).toEqual([...adopted].sort());

    const unitById = new Map(PRESCRIPTION_PARAMETER_SPECS.map((spec) => [spec.id, spec.unit]));
    for (const id of adopted) {
      expect({ id, unit: supplied.get(id) }).toEqual({ id, unit: unitById.get(id) });
    }
  });

  it("records the owner's sentence exactly as the artifact carries it", () => {
    // The sheet is the record of where these numbers came from. If the sheet
    // and the artifact ever disagree about that sentence, one of them is
    // describing values the other does not hold.
    //
    // The trailing full stop is compared out, and that is not laziness: the
    // ADOPTED section of the sheet closes the quotation *before* the stop
    // ("...literature sources"), while the dispatch that ordered the ingestion
    // and the 35 training rows already in the bundle both close it after
    // ("...literature source."). One character, in a string that has to be
    // verbatim, so it is named here rather than silently normalised. The
    // artifact carries the sentence-complete form; if the owner wants the
    // other one, it is a one-line change to 15 provenance rows and this pin.
    const text = readWorksheet();
    expect(text).toContain(OWNER_PROVENANCE_SENTENCE.replace(/\.$/, ""));

    const file = loadDraftUnsignedPolicyBundle();
    if (file.reviewMetadata.decision !== "APPROVED") throw new Error("bundle is not signed");
    const byParameter = new Map(
      (file.reviewMetadata.proposalProvenance ?? []).map((row) => [row.parameterId, row])
    );
    const floors = [
      file.content.safetyControls.nutritionLimits.minimumDailyEnergyParameterId,
      file.content.safetyControls.nutritionLimits.maximumWeeklyLossRateParameterId,
    ];
    const ingested = [...ownerAdoptedPrescriptionIds(), ...floors];
    expect(ingested).toHaveLength(15);
    for (const id of ingested) {
      expect({ id, locator: byParameter.get(id)?.sourceLocator }).toEqual({
        id,
        locator: OWNER_PROVENANCE_SENTENCE,
      });
      expect({ id, claim: byParameter.get(id)?.sourceClaimId }).toEqual({
        id,
        claim: OWNER_ADOPTION_CLAIM_ID,
      });
    }
  });

  it("quotes the safety-floor hook names the bundle actually carries", () => {
    // Section C tells the reader which two hooks the floors reach the engine
    // through. If the bundle's hook names change and the sheet keeps quoting
    // the old ones, the record becomes wrong in the most dangerous place on
    // the sheet.
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
    // And the placeholders it replaced are described as past, not current.
    for (const placeholder of [
      "PENDING_RD_DECISION_MIN_DAILY_ENERGY",
      "PENDING_RD_DECISION_MAX_WEEKLY_LOSS_RATE",
    ]) {
      expect({ placeholder, stillNamedAsCurrent: text.includes(`currently: ${placeholder}`) }).toEqual(
        { placeholder, stillNamedAsCurrent: false }
      );
    }
  });
});
