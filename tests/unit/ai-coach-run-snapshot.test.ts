import { describe, expect, it } from "vitest";
import { runSnapshotSchema } from "@/lib/ai-coach/run-command";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { LEGACY_RUN_SNAPSHOT } from "../fixtures/ai-coach-legacy-run-snapshot";

/**
 * T-2041 — `runSnapshotSchema` gains one optional key, `runtimeBinding`, and
 * widens four `z.literal`s in place. Both halves are load-bearing and both
 * are content-hash sensitive: the parsed snapshot is hashed into
 * `AiCoachRun.businessKey` (run identity / dedup) and into
 * `AiPlanVersion.validationReport.inputHash`, which `weekly-proof.ts`
 * re-derives on every weekly acceptance.
 *
 * The single most important assertion in this ticket is the golden hash
 * below. It was captured by parsing `LEGACY_RUN_SNAPSHOT` through the
 * **pre-change** `runSnapshotSchema` at base commit 7bd49f1, before a line of
 * this ticket was written. See `board/evidence/T-2041.md` for the exact
 * command.
 */
const GOLDEN_LEGACY_SNAPSHOT_HASH =
  "f0996c93f14ee161ef819a25ad0fe3efdaf867c69d5e6942041f73f5b9faa800";

const LIVE_BINDING = {
  mode: "LIVE" as const,
  engineVersion: "ai-coach-artifact-engine-v1",
  synthetic: false,
  contentKind: "REVIEWED_LIVE_V1" as const,
  modelConfiguration: "synthetic-final-provider-v1:v1",
  policyVersion: "live-policy",
  catalogVersions: { food: "live-food", exercise: "live-exercise" },
  artifactRefs: (
    [
      ["ESCALATION_TEMPLATES", "live-escalation"],
      ["EVIDENCE_REGISTRY", "live-evidence"],
      ["EXERCISE_CATALOG", "live-exercise"],
      ["FOOD_CATALOG", "live-food"],
      ["POLICY_BUNDLE", "live-policy"],
    ] as const
  ).map(([kind, artifactKey]) => ({
    id: `${artifactKey}:v1`,
    artifactKey,
    version: 1,
    kind,
    digest: "c".repeat(64),
  })),
};

const BOUND_LIVE_SNAPSHOT = {
  ...LEGACY_RUN_SNAPSHOT,
  synthetic: LIVE_BINDING.synthetic,
  policyVersion: LIVE_BINDING.policyVersion,
  catalogVersions: LIVE_BINDING.catalogVersions,
  modelConfiguration: LIVE_BINDING.modelConfiguration,
  runtimeBinding: LIVE_BINDING,
};

describe("T-2041 — run snapshot back-compatibility", () => {
  it("golden hash: a stored legacy snapshot hashes exactly as it did before this change", () => {
    expect(contentHash(runSnapshotSchema.parse(LEGACY_RUN_SNAPSHOT))).toBe(
      GOLDEN_LEGACY_SNAPSHOT_HASH
    );
  });

  it("the .default() tripwire: parsing a legacy snapshot materialises no runtimeBinding key at all", () => {
    const parsed = runSnapshotSchema.parse(LEGACY_RUN_SNAPSHOT);
    expect(Object.hasOwn(parsed, "runtimeBinding")).toBe(false);
  });

  it("re-storing a parsed legacy snapshot round-trips byte-identically (retry-command.ts)", () => {
    const parsed = runSnapshotSchema.parse(LEGACY_RUN_SNAPSHOT);
    const restored = runSnapshotSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(contentHash(restored)).toBe(GOLDEN_LEGACY_SNAPSHOT_HASH);
    expect(Object.hasOwn(restored, "runtimeBinding")).toBe(false);
  });

  it("an unbound snapshot claiming synthetic: false fails to parse", () => {
    const result = runSnapshotSchema.safeParse({ ...LEGACY_RUN_SNAPSHOT, synthetic: false });
    expect(result.success).toBe(false);
  });

  it("an unbound snapshot carrying a non-fixture policyVersion fails to parse", () => {
    const result = runSnapshotSchema.safeParse({
      ...LEGACY_RUN_SNAPSHOT,
      policyVersion: "live-policy",
    });
    expect(result.success).toBe(false);
  });

  it("an unbound snapshot carrying a non-fixture modelConfiguration fails to parse", () => {
    const result = runSnapshotSchema.safeParse({
      ...LEGACY_RUN_SNAPSHOT,
      modelConfiguration: "some-live-provider:v1",
    });
    expect(result.success).toBe(false);
  });
});

describe("T-2041 — a bound run snapshot", () => {
  it("parses when every top-level value agrees with its frozen binding", () => {
    const parsed = runSnapshotSchema.parse(BOUND_LIVE_SNAPSHOT);
    expect(parsed.runtimeBinding?.policyVersion).toBe("live-policy");
    expect(parsed.policyVersion).toBe("live-policy");
  });

  it("round-trips through JSON with an identical contentHash (the retry-command re-store)", () => {
    const parsed = runSnapshotSchema.parse(BOUND_LIVE_SNAPSHOT);
    const restored = runSnapshotSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(contentHash(restored)).toBe(contentHash(parsed));
    expect(restored.runtimeBinding).toEqual(parsed.runtimeBinding);
  });

  it("fails to parse when the binding's policyVersion disagrees with the top-level one", () => {
    const result = runSnapshotSchema.safeParse({
      ...BOUND_LIVE_SNAPSHOT,
      policyVersion: "a-different-policy",
    });
    expect(result.success).toBe(false);
  });

  it("fails to parse when the binding's catalogVersions disagree with the top-level ones", () => {
    const result = runSnapshotSchema.safeParse({
      ...BOUND_LIVE_SNAPSHOT,
      catalogVersions: { food: "live-food", exercise: "another-exercise" },
    });
    expect(result.success).toBe(false);
  });

  it("fails to parse when the binding itself is mixed (a key no reference supplies)", () => {
    const result = runSnapshotSchema.safeParse({
      ...BOUND_LIVE_SNAPSHOT,
      runtimeBinding: { ...LIVE_BINDING, policyVersion: "live-policy-mismatch" },
      policyVersion: "live-policy-mismatch",
    });
    expect(result.success).toBe(false);
  });

  it("a bound snapshot and its legacy twin do not collide on one business key", () => {
    // The spec's stated, accepted consequence: a run bound to an artifact set
    // is a different run identity from an unbound one, so dedup reshards for
    // a request issued identically before and after this change.
    expect(contentHash(runSnapshotSchema.parse(BOUND_LIVE_SNAPSHOT))).not.toBe(
      GOLDEN_LEGACY_SNAPSHOT_HASH
    );
  });
});
