import { describe, expect, it } from "vitest";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";
import { loadDraftUnsignedEvidenceRegistry } from "@/lib/ai-coach/artifacts/drafts/evidence-registry";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import {
  evidenceRegistryContentSchema,
  policyBundleContentSchema,
} from "@/lib/ai-coach/artifacts/schema";

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
 */

type Coverage = { ruleId: string; covering: string[] };

function uncovered(
  policy: { evidenceRuleIds: readonly string[] },
  claims: readonly { id: string; ruleIds: readonly string[] }[]
): Coverage[] {
  return policy.evidenceRuleIds
    .map((ruleId) => ({
      ruleId,
      covering: claims.filter((claim) => claim.ruleIds.includes(ruleId)).map((claim) => claim.id),
    }))
    .filter((entry) => entry.covering.length === 0);
}

describe("S-17 — no artifact set may declare an evidence rule with no covering claim", () => {
  it("covers every evidence rule in the signed policy bundle", () => {
    const policy = loadDraftUnsignedPolicyBundle().content;
    const registry = loadDraftUnsignedEvidenceRegistry().content;
    expect(policy.evidenceRuleIds.length).toBeGreaterThan(0);
    expect(uncovered(policy, registry.claims)).toEqual([]);
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
      expect({ namespace, uncovered: uncovered(policy, registry.claims) }).toEqual({
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
    expect(uncovered(policy, stripped)).toEqual([
      { ruleId: policy.evidenceRuleIds[0], covering: [] },
    ]);
  });
});
