# Synthetic activation and operations contract (T-1008–T-1010)

Status: structural synthetic/demo implementation only. This document is not a live-launch approval.

## Actionability invariant

A managed proposal is actionable only when all of the following remain true:

1. the persisted account is an active synthetic client with unambiguous AI authority and entitlement;
2. the exact reviewed T-1005 artifact set is published, effective, unexpired, compatible, digest-valid and synthetic;
3. the latest T-1003 nutrition decision passes for the candidate and retained history;
4. T-1006 returns `APPROVE_AUTOMATICALLY` for the exact candidate, evidence, sources and revision tuple;
5. the constrained T-1007 provider returns only allowlisted references and a second T-1006 evaluation produces the same binding;
6. an immutable `AiAutomaticPlanApproval` binds the candidate, gate decision, provider audit and artifact/source references; and
7. acceptance creates a fresh T-1006 decision and atomically rechecks every binding before changing the active pointer.

Reviewer approval is not an authorization input for managed proposals. A model cannot create an approval, alter policy/catalog facts, choose tenant identity, or activate a plan. Failed or unavailable checks expose no proposal instructions.

## Synthetic client flow

The authenticated client completes structured intake and all synthetic screening fields, explicitly enrolls, requests deterministic preparation, runs final safety checks, reviews the proposal only after automatic approval, and explicitly accepts it. Check-ins, activity corrections, intake changes, safety changes, authority changes, artifact changes and source deletion invalidate the frozen bindings and require a new candidate/finalization.

Web and native clients receive only safe status, reason-code and reviewed-template identifiers plus a validated interpretation assembled from allowlisted references. Raw prompts, provider traces, arbitrary provider prose, health notes, other-client identifiers and internal errors are not client DTO fields.

## Governance and kill switches

`AiCoachGovernanceGrant` is separate from reviewer authority. Scoped grants control artifact publication/revocation, operational controls and aggregate monitoring. Lifecycle and control changes create immutable audit events. A governed artifact revocation disables generation, provider, finalization and acceptance controls in the same transaction.

Operational scopes are `GENERATION`, `PROVIDER`, `FINALIZATION`, `ACCEPTANCE` and `ARTIFACT_PUBLICATION`. Controls can only narrow the existing disabled-by-default environment flags. Monitoring is aggregate-only and excludes intake bodies, safety answers, notes, prompts, traces and client identifiers.

`pnpm run ai-coach:release-evidence` runs the versioned synthetic corpus, focused PostgreSQL safety/tenant tests and kill-switch/rollback drill. The current evidence record is [T-1009/T-1010 synthetic release evidence v1](evidence/T-1009-T-1010-release-evidence-v1.md); its measured synthetic latency/token data is not a live SLO or provider benchmark.

Client-scoped automatic approvals and activation attempts are included in exports and purged during account deletion. Global reviewed artifacts and aggregate governance records are excluded from client exports.

## Live activation blockers

All enrollment, generation and publication flags remain disabled by default. Production fixture mode is prohibited, real accounts cannot load synthetic artifacts, and the T-1006/T-1003 structural implementations reject live artifacts.

Live activation remains blocked until all of these exist and are linked to immutable release evidence:

- versioned live nutrition policy and authoritative food/exercise/evidence/escalation artifacts;
- qualified nutrition-professional approval for every safety threshold, screening cutoff and client-facing claim;
- jurisdiction-specific legal/scope review;
- provider privacy and security approval, including retention, data-flow and vendor configuration review;
- named operational ownership, on-call response, incident criteria and practiced rollback/kill-switch runbooks;
- production model/configuration evaluation and adversarial evidence;
- cross-platform release evidence for the exact artifact/model/application versions; and
- an explicit governance decision to enable each narrow feature flag and operational scope.

Public discovery remains out of scope until T-1011.
