import type { SourceRef } from "../plan-contract";

/**
 * S-29 — the one relation for "is a policy evidence rule substantiated".
 *
 * Before this file the relation was implemented three times and consumed by
 * a fourth, disagreeing caller:
 *   - `assertEvidenceRulesHaveClaims` (`lib/ai-coach/autonomy/gate.ts`), the
 *     hard precondition that throws `ARTIFACT_INCOMPATIBLE` inside the gate
 *     transaction (S-17, added after T-2007 added a rule id with no claim
 *     and 27 integration tests failed across ten files).
 *   - The local `uncovered()` helper in
 *     `tests/unit/ai-coach-evidence-rule-coverage.test.ts`, which only ever
 *     checked the *shipped* bundles, never what finalization actually wrote.
 *   - `lib/ai-coach/finalization.ts`, which never computed this at all: it
 *     hardcoded `status: ruleId === "SYNTHETIC_EVIDENCE_RULE" ? "SUFFICIENT"
 *     : "UNKNOWN"`, true only while the fixture bundle declared exactly one
 *     evidence rule. T-2007 added a second rule id
 *     (`WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1`) to `evidenceRuleIds`, and the
 *     real signed bundle declares neither hardcoded id, so finalization
 *     wrote `UNKNOWN` for every real candidate and the gate turned that into
 *     `GATE_EVIDENCE_MISSING` -> `FOCUSED_CLARIFICATION` for every one of
 *     them. S-17's fix silenced the loud failure (the 503) and left the
 *     silent one (`finalization.ts`) in place — that mismatch is exactly the
 *     failure class this module exists to delete.
 *
 * T-2000 review r1 BLOCKER 1 (`board/reviews/T-2000-r1.md:16-47`) asked for
 * exactly this: "map ... any evidence rule it cannot substantiate to the
 * non-sufficient status." The only substantiating object the server holds is
 * the reviewed, digest-verified `EVIDENCE_REGISTRY`'s claims, so
 * `evidence[].status` is derived provenance: `SUFFICIENT` iff some reviewed
 * claim lists the rule in `ruleIds`, `UNKNOWN` otherwise. There is no third
 * value — this module never returns `INSUFFICIENT`; see the ticket's "What
 * this does not fix" for why that is a deliberately named open question, not
 * an oversight.
 *
 * All four callers (the gate precondition, finalization, the harness's two
 * gate-input builders, and this invariant's unit test) must call these
 * functions. An inline copy of this predicate anywhere is the exact defect
 * this module exists to delete.
 */

/** The only shape any caller needs from an EVIDENCE_REGISTRY claim. */
export type EvidenceClaimCoverage = readonly { readonly ruleIds: readonly string[] }[];

export type DerivedEvidenceStatus = "SUFFICIENT" | "UNKNOWN";

export type DerivedEvidenceEntry = {
  readonly ruleId: string;
  readonly status: DerivedEvidenceStatus;
  readonly sourceRefs: readonly SourceRef[];
};

/**
 * The one relation. A policy evidence rule is substantiated iff some
 * reviewed claim in the same artifact set lists it in `ruleIds`.
 */
export function evidenceRuleIsSubstantiated(
  ruleId: string,
  claims: EvidenceClaimCoverage
): boolean {
  return claims.some((claim) => claim.ruleIds.includes(ruleId));
}

/** Every declared rule with no covering claim, in declaration order. */
export function unsubstantiatedEvidenceRuleIds(
  evidenceRuleIds: readonly string[],
  claims: EvidenceClaimCoverage
): string[] {
  return evidenceRuleIds.filter((ruleId) => !evidenceRuleIsSubstantiated(ruleId, claims));
}

/**
 * The autonomy gate's `evidence[]` entries. Preserves `evidenceRuleIds`
 * declaration order and keeps only the first occurrence of a duplicated id;
 * `serverAutonomyGateInputSchema` requires uniqueness (`gate.ts:100-108`) and
 * `contentHash` is order-sensitive for arrays (`canonical-json.ts:7`), so
 * both properties are part of this contract.
 */
export function deriveEvidenceGateEntries(input: {
  readonly evidenceRuleIds: readonly string[];
  readonly claims: EvidenceClaimCoverage;
  readonly sourceRefs: readonly SourceRef[];
}): DerivedEvidenceEntry[] {
  const seen = new Set<string>();
  const entries: DerivedEvidenceEntry[] = [];
  for (const ruleId of input.evidenceRuleIds) {
    if (seen.has(ruleId)) continue;
    seen.add(ruleId);
    entries.push({
      ruleId,
      status: evidenceRuleIsSubstantiated(ruleId, input.claims) ? "SUFFICIENT" : "UNKNOWN",
      sourceRefs: input.sourceRefs,
    });
  }
  return entries;
}
