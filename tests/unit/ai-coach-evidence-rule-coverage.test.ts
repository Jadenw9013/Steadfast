import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";
import { loadDraftUnsignedEvidenceRegistry } from "@/lib/ai-coach/artifacts/drafts/evidence-registry";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { WEEKLY_EVIDENCE_RULE_ID } from "@/lib/ai-coach/weekly-parameters";
import {
  evidenceRegistryContentSchema,
  policyBundleContentSchema,
} from "@/lib/ai-coach/artifacts/schema";
import {
  deriveEvidenceGateEntries,
  evidenceRuleIsSubstantiated,
  unsubstantiatedEvidenceRuleIds,
  type EvidenceClaimCoverage,
} from "@/lib/ai-coach/autonomy/evidence-status";

/**
 * S-17 — every policy evidence rule has a covering claim, in **every** artifact
 * set this repository ships.
 *
 * `assertEvidenceRulesHaveClaims` (`lib/ai-coach/autonomy/gate.ts`) throws
 * `ARTIFACT_INCOMPATIBLE` *inside the gate transaction* when a policy evidence
 * rule has no covering claim. That is a 503 with no `AiAutonomyGateDecision`
 * row — no record that the client was refused, for every client who touches the
 * rule. Nothing on the publication path catches it: `assertArtifactSetReferences`
 * does not check `evidenceRuleIds` coverage, so a signed bundle with the gap
 * publishes cleanly and then fails every request.
 *
 * It has now happened once for real. T-2007 added
 * `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` to the synthetic fixture's
 * `evidenceRuleIds` and did not add a claim for it, and it reached
 * `team/sprint-1`, where it was 27 of 47 integration failures across ten files.
 * Nothing failed at the point the rule was added, which is the actual problem
 * this file fixes: the invariant was only ever checked for the draft bundle, so
 * a whole artifact set could acquire the hole unobserved.
 *
 * Adding a rule to `evidenceRuleIds` without a claim now turns this red in the
 * unit suite, seconds after it is written, instead of in a PostgreSQL
 * integration run on somebody else's branch.
 *
 * S-29 — the local `uncovered()` helper this file used to define is now
 * `unsubstantiatedEvidenceRuleIds` in `lib/ai-coach/autonomy/evidence-status.ts`,
 * the one shared module `assertEvidenceRulesHaveClaims`, `finalization.ts`'s
 * `evidence[].status` derivation, and the harness's two gate-input builders
 * all call. This file is this invariant's home and now also the unit proof
 * that the shared function itself has the fail-closed behaviour T-2000 review
 * r1 BLOCKER 1 (`board/reviews/T-2000-r1.md:16-47`) asked for.
 */

describe("S-17 — no artifact set may declare an evidence rule with no covering claim", () => {
  it("covers every evidence rule in the signed policy bundle", () => {
    const policy = loadDraftUnsignedPolicyBundle().content;
    const registry = loadDraftUnsignedEvidenceRegistry().content;
    expect(policy.evidenceRuleIds.length).toBeGreaterThan(0);
    expect(unsubstantiatedEvidenceRuleIds(policy.evidenceRuleIds, registry.claims)).toEqual([]);
  });

  it("covers every evidence rule in every synthetic artifact set", () => {
    // Both namespaces the fixture builder serves. `t1008-runtime` is the one the
    // runtime-binding and weekly-trajectory integration tests publish.
    for (const namespace of ["t1005-fixture", "t1008-runtime"]) {
      const set =
        namespace === "t1005-fixture"
          ? buildSyntheticArtifactSet()
          : buildSyntheticArtifactSet(namespace);
      const policy = policyBundleContentSchema.parse(set.policyBundle.content);
      const registry = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content);
      expect(policy.evidenceRuleIds.length).toBeGreaterThan(0);
      expect({
        namespace,
        uncovered: unsubstantiatedEvidenceRuleIds(policy.evidenceRuleIds, registry.claims),
      }).toEqual({
        namespace,
        uncovered: [],
      });
    }
  });

  it("fails when a rule loses its claim, so the guard is known to be able to fail", () => {
    // Red-proof. An assertion of the shape "expected [] to equal []" passes for
    // an empty input just as happily as for a correct one; this shows it does
    // not.
    const set = buildSyntheticArtifactSet();
    const policy = policyBundleContentSchema.parse(set.policyBundle.content);
    const registry = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content);
    const stripped = registry.claims.map((claim) => ({
      ...claim,
      ruleIds: claim.ruleIds.filter((ruleId) => ruleId !== policy.evidenceRuleIds[0]),
    }));
    expect(unsubstantiatedEvidenceRuleIds(policy.evidenceRuleIds, stripped)).toEqual([
      policy.evidenceRuleIds[0],
    ]);
  });
});

describe("S-29 — the shared evidence-status module", () => {
  it("evidenceRuleIsSubstantiated returns false for an id no claim lists, and for an empty claim list", () => {
    const claims: EvidenceClaimCoverage = [{ ruleIds: ["SOME_OTHER_RULE"] }];
    expect(evidenceRuleIsSubstantiated("NOT_COVERED", claims)).toBe(false);
    expect(evidenceRuleIsSubstantiated("NOT_COVERED", [])).toBe(false);
    expect(evidenceRuleIsSubstantiated("SOME_OTHER_RULE", claims)).toBe(true);
  });

  it("deriveEvidenceGateEntries over the real draft bundle yields SUFFICIENT for both declared rules", () => {
    const policy = loadDraftUnsignedPolicyBundle().content;
    const registry = loadDraftUnsignedEvidenceRegistry().content;
    const entries = deriveEvidenceGateEntries({
      evidenceRuleIds: policy.evidenceRuleIds,
      claims: registry.claims,
      sourceRefs: [],
    });
    expect(entries.map((entry) => ({ ruleId: entry.ruleId, status: entry.status }))).toEqual([
      { ruleId: "NUTRITION_EVIDENCE_RULE", status: "SUFFICIENT" },
      { ruleId: "WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1", status: "SUFFICIENT" },
    ]);
  });

  it("deriveEvidenceGateEntries over both synthetic namespaces yields all-SUFFICIENT", () => {
    for (const namespace of ["t1005-fixture", "t1008-runtime"] as const) {
      const set =
        namespace === "t1005-fixture"
          ? buildSyntheticArtifactSet()
          : buildSyntheticArtifactSet(namespace);
      const policy = policyBundleContentSchema.parse(set.policyBundle.content);
      const registry = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content);
      expect(policy.evidenceRuleIds).toEqual(["SYNTHETIC_EVIDENCE_RULE", WEEKLY_EVIDENCE_RULE_ID]);
      const entries = deriveEvidenceGateEntries({
        evidenceRuleIds: policy.evidenceRuleIds,
        claims: registry.claims,
        sourceRefs: [],
      });
      expect({
        namespace,
        statuses: entries.map((entry) => entry.status),
      }).toEqual({
        namespace,
        statuses: ["SUFFICIENT", "SUFFICIENT"],
      });
    }
  });

  it("fails closed (T-2000 review r1 BLOCKER 1): a rule with no covering claim derives UNKNOWN, not absent and not SUFFICIENT, and the gate turns it into GATE_EVIDENCE_MISSING / FOCUSED_CLARIFICATION", () => {
    const set = buildSyntheticArtifactSet();
    const policy = policyBundleContentSchema.parse(set.policyBundle.content);
    const registry = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content);
    const strippedClaims = registry.claims.map((claim) => ({
      ...claim,
      ruleIds: claim.ruleIds.filter((ruleId) => ruleId !== WEEKLY_EVIDENCE_RULE_ID),
    }));

    const entries = deriveEvidenceGateEntries({
      evidenceRuleIds: policy.evidenceRuleIds,
      claims: strippedClaims,
      sourceRefs: [],
    });
    const weeklyEntry = entries.find((entry) => entry.ruleId === WEEKLY_EVIDENCE_RULE_ID);
    expect(weeklyEntry).toBeDefined();
    expect(weeklyEntry?.status).toBe("UNKNOWN");

    // This is exactly the input shape `gate.ts`'s evaluateAutonomyGate turns
    // into GATE_EVIDENCE_MISSING -> FOCUSED_CLARIFICATION: a declared
    // evidence rule id present in `input.evidence` with status "UNKNOWN".
    // (`autonomy/gate.ts:298-303`: `input.evidence.some((item) => item.status
    // === "UNKNOWN")` triggers before INSUFFICIENT/stale checks are reached.)
    expect(
      entries.some((entry) => entry.ruleId === WEEKLY_EVIDENCE_RULE_ID && entry.status === "UNKNOWN")
    ).toBe(true);
  });

  it("preserves evidenceRuleIds declaration order and collapses a duplicated id to its first occurrence", () => {
    const draftPolicy = loadDraftUnsignedPolicyBundle().content;
    const draftRegistry = loadDraftUnsignedEvidenceRegistry().content;
    const draftEntries = deriveEvidenceGateEntries({
      evidenceRuleIds: draftPolicy.evidenceRuleIds,
      claims: draftRegistry.claims,
      sourceRefs: [],
    });
    expect(draftEntries.map((entry) => entry.ruleId)).toEqual(draftPolicy.evidenceRuleIds);

    const set = buildSyntheticArtifactSet();
    const fixturePolicy = policyBundleContentSchema.parse(set.policyBundle.content);
    const fixtureRegistry = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content);
    const fixtureEntries = deriveEvidenceGateEntries({
      evidenceRuleIds: fixturePolicy.evidenceRuleIds,
      claims: fixtureRegistry.claims,
      sourceRefs: [],
    });
    expect(fixtureEntries.map((entry) => entry.ruleId)).toEqual(fixturePolicy.evidenceRuleIds);

    // A duplicated id collapses to its first occurrence; canonical-json.ts is
    // order-sensitive for arrays and gate.ts requires uniqueness, so both
    // properties are part of this contract.
    const duplicated = [
      draftPolicy.evidenceRuleIds[0],
      draftPolicy.evidenceRuleIds[1],
      draftPolicy.evidenceRuleIds[0],
    ];
    const dedupedEntries = deriveEvidenceGateEntries({
      evidenceRuleIds: duplicated,
      claims: draftRegistry.claims,
      sourceRefs: [],
    });
    expect(dedupedEntries.map((entry) => entry.ruleId)).toEqual([
      draftPolicy.evidenceRuleIds[0],
      draftPolicy.evidenceRuleIds[1],
    ]);
  });

  it("(harness guard) the validation harness derives evidence status from the shared function, and the one deliberate literal SUFFICIENT probe is the only one left", () => {
    // S-29 — scripts/ai-coach-validation-harness.ts calls main() at top
    // level and is outside tsconfig's `include`, so it cannot be imported
    // from a test; this asserts on its source text instead. A comment in
    // the harness explains why the count is 1 and not 0: the
    // `GATE_EVIDENCE_INVALID` reachability probe at the "evidence rule not
    // in the policy's set" case is a deliberate literal that
    // `deriveEvidenceGateEntries` could never produce (it only ever
    // iterates the policy's own declared rule ids).
    const harnessPath = path.join(process.cwd(), "scripts/ai-coach-validation-harness.ts");
    const source = fs.readFileSync(harnessPath, "utf8");
    expect(source).toMatch(/deriveEvidenceGateEntries/);
    expect(source).toMatch(/from\s+["'](?:@\/)?(?:\.\.\/)*lib\/ai-coach\/autonomy\/evidence-status["']/);
    const matches = source.match(/status:\s*"SUFFICIENT"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
