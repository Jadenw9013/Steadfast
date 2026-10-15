import type { PrescriptionReasonCode } from "./prescription";

/**
 * T-2033 review r1 (MINOR 5/7) — the *single* three-class split over
 * `PrescriptionReasonCode`, used by `autonomy/gate.ts` (`outcomeFor`),
 * `initial-plan.ts` (the `UNAVAILABLE` decision) and `finalization.ts`
 * (stale-candidate reason reporting). CLAUDE.md rule 1: one implementation,
 * not a copy per consumer.
 *
 * - `CLIENT_FIXABLE` — the client can resolve it by answering or re-confirming
 *   intake (T-2003 Contract "Gate": `FOCUSED_CLARIFICATION`).
 * - `OUT_OF_SCOPE` — outside the reviewed scope of this program; no client
 *   action resolves it (`PAUSE_REFER`).
 * - `POLICY_NOT_READY` — the reviewed bundle cannot produce a prescription
 *   (an unsigned/absent parameter, an unsupported method, an unavailable
 *   reviewed explanation). Nothing the client does changes it (`HOLD`).
 *
 * `PRESCRIPTION_REASON_CLASS` is declared as a total `Record` over the union
 * on purpose: adding a `PrescriptionReasonCode` without classifying it is a
 * compile error rather than a silent default.
 */
export type PrescriptionReasonClass = "CLIENT_FIXABLE" | "OUT_OF_SCOPE" | "POLICY_NOT_READY";

const PRESCRIPTION_REASON_CLASS: Record<PrescriptionReasonCode, PrescriptionReasonClass> = {
  PRESCRIPTION_INPUT_MISSING: "CLIENT_FIXABLE",
  PRESCRIPTION_GOAL_PACE_UNDECIDED: "CLIENT_FIXABLE",
  PRESCRIPTION_WEIGHT_MEASUREMENT_STALE: "CLIENT_FIXABLE",
  PRESCRIPTION_POPULATION_UNSUPPORTED: "OUT_OF_SCOPE",
  PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED: "OUT_OF_SCOPE",
  PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE: "OUT_OF_SCOPE",
  PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE: "CLIENT_FIXABLE",
  PRESCRIPTION_INTAKE_VERSION_UNSUPPORTED: "POLICY_NOT_READY",
  PRESCRIPTION_MAINTENANCE_BELOW_MINIMUM: "POLICY_NOT_READY",
  PRESCRIPTION_MACRO_RANGES_INFEASIBLE: "POLICY_NOT_READY",
  PRESCRIPTION_PARAMETER_MISSING: "POLICY_NOT_READY",
  PRESCRIPTION_PARAMETER_INCOMPATIBLE: "POLICY_NOT_READY",
  PRESCRIPTION_METHOD_UNSUPPORTED: "POLICY_NOT_READY",
  PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE: "POLICY_NOT_READY",
};

/** Every `PrescriptionReasonCode`, derived from the total class map above so
 * the two can never drift. Consumed by the live-launch escalation-template
 * coverage assertion (`artifacts/repository.ts`). */
export const PRESCRIPTION_REASON_CODES = Object.keys(
  PRESCRIPTION_REASON_CLASS
) as PrescriptionReasonCode[];

/** An *unknown* code (forward compatibility: a newer deploy's row read by an
 * older one) is `POLICY_NOT_READY` — the fail-closed class, never the one
 * that tells a client their own answers are at fault. */
export function classifyPrescriptionReasonCode(code: string): PrescriptionReasonClass {
  return PRESCRIPTION_REASON_CLASS[code as PrescriptionReasonCode] ?? "POLICY_NOT_READY";
}

/** The most protective class present, mirroring `outcomeFor`'s
 * `PAUSE_REFER` > `HOLD` > `FOCUSED_CLARIFICATION` precedence. An empty set
 * is `POLICY_NOT_READY` (the gate's documented "no reason given" -> HOLD). */
export function classifyPrescriptionReasonCodes(codes: readonly string[]): PrescriptionReasonClass {
  let result: PrescriptionReasonClass = codes.length === 0 ? "POLICY_NOT_READY" : "CLIENT_FIXABLE";
  for (const code of codes) {
    const current = classifyPrescriptionReasonCode(code);
    if (current === "OUT_OF_SCOPE") return "OUT_OF_SCOPE";
    if (current === "POLICY_NOT_READY") result = "POLICY_NOT_READY";
  }
  return result;
}
