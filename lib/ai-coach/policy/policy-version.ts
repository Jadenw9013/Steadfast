/**
 * A04 — versioned policy compatibility/revocation checks.
 *
 * *** SYNTHETIC FIXTURE — NOT REVIEWED CLINICAL POLICY ***
 * The single active version and the revoked-version set below exist only
 * to exercise the control flow: a plan payload's `policyVersion` must
 * name a currently active, non-revoked policy before it can be treated
 * as usable. Real policy content and its actual version history are gate
 * G01's deliverable (docs/ai-coach/13-Sources-and-Open-Decisions.md).
 * Superseding the active version here must never happen by silently
 * editing this constant in place — a real policy revision creates a new
 * version and explicitly revokes the old one, same as this fixture does.
 */

export const ACTIVE_POLICY_VERSION = "policy-fixture-v1";

const REVOKED_POLICY_VERSIONS: ReadonlySet<string> = new Set(["policy-fixture-v0"]);

export type PolicyUsabilityError = "UNKNOWN_POLICY_VERSION" | "POLICY_REVOKED";
export type PolicyUsabilityResult = { usable: true } | { usable: false; error: PolicyUsabilityError };

export function checkPolicyVersionUsable(policyVersion: string): PolicyUsabilityResult {
  if (policyVersion === ACTIVE_POLICY_VERSION) return { usable: true };
  if (REVOKED_POLICY_VERSIONS.has(policyVersion)) return { usable: false, error: "POLICY_REVOKED" };
  return { usable: false, error: "UNKNOWN_POLICY_VERSION" };
}
