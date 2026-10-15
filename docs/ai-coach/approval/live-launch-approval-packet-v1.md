# AI Coach live-launch approval packet v1

Packet status: **DRAFT — NOT AUTHORIZED**  
Machine-readable template: `live-launch-packet.template.v1.json`  
Scope: a future, explicitly governed live release; synthetic/demo behavior remains the only implemented runtime  
Public discovery: out of scope (T-1011 is not implemented)

This is a signable review index, not a policy decision. Blank decisions remain blank. NASM and ACE may be cited only as public scope-reference frameworks; their proprietary materials must not be copied, and no affiliation, endorsement, certification, or approval may be implied.

## Release identity and immutable bindings

| Field                                   | Required value                                                          |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Packet ID/version                       | REQUIRED HUMAN DECISION: allocate immutable packet identity and version |
| Application release and source revision | REQUIRED HUMAN DECISION: exact deployable revision                      |
| AI Coach engine version                 | REQUIRED HUMAN DECISION: exact compatible engine version                |
| iOS revision/platform matrix            | REQUIRED HUMAN DECISION: exact native revision and supported matrix     |
| Jurisdictions                           | REQUIRED HUMAN DECISION: counsel-approved list                          |
| Effective/expiry window                 | REQUIRED HUMAN DECISION: bounded governed window                        |
| Policy bundle ID/version/digest         | REQUIRED HUMAN DECISION: reviewed non-synthetic artifact                |
| Food catalog ID/version/digest          | REQUIRED HUMAN DECISION: reviewed non-synthetic artifact                |
| Exercise catalog ID/version/digest      | REQUIRED HUMAN DECISION: reviewed non-synthetic artifact                |
| Evidence registry ID/version/digest     | REQUIRED HUMAN DECISION: reviewed non-synthetic artifact                |
| Escalation templates ID/version/digest  | REQUIRED HUMAN DECISION: reviewed non-synthetic artifact                |
| Provider configuration/version          | REQUIRED HUMAN DECISION: privacy/security-approved configuration        |

The five artifact bindings must be exact, current, mutually compatible, non-synthetic, digest-valid, published, effective, unexpired, and unrevoked. The policy dependency set must exactly equal the other four bindings. No “latest” lookup or replacement is permitted.

## Nutrition-policy decisions D01–D12

The qualified reviewer completes the HQ nutrition-professional worksheet first. Each signed decision attachment must include evidence links; population and exclusions; risks and uncertainty; exact artifact fields and units; reviewer identity, role, and qualifications; required legal concurrence; and post-approval test cases.

| ID  | Decision requiring accountable review                                      | Status                  |
| --- | -------------------------------------------------------------------------- | ----------------------- |
| D01 | Supported population, goals, and exclusions                                | REQUIRED HUMAN DECISION |
| D02 | Age eligibility and routing                                                | REQUIRED HUMAN DECISION |
| D03 | Pregnancy/postpartum handling                                              | REQUIRED HUMAN DECISION |
| D04 | Eating-disorder history/concern handling                                   | REQUIRED HUMAN DECISION |
| D05 | Diabetes and medical-condition exclusions                                  | REQUIRED HUMAN DECISION |
| D06 | Screening instrument, cutoffs, missing/uncertain handling, and escalation  | REQUIRED HUMAN DECISION |
| D07 | Energy-floor policy fields, units, applicability, exceptions, and evidence | REQUIRED HUMAN DECISION |
| D08 | Rate-limit fields, units, applicability, exceptions, and evidence          | REQUIRED HUMAN DECISION |
| D09 | No-consecutive-deficit interpretation, state inputs, and escalation        | REQUIRED HUMAN DECISION |
| D10 | Adjustment cadence, cooldowns, cumulative limits, and stop conditions      | REQUIRED HUMAN DECISION |
| D11 | Emergency, pause, referral, and client-facing wording                      | REQUIRED HUMAN DECISION |
| D12 | Post-approval tests, monitoring, incident triggers, and renewal criteria   | REQUIRED HUMAN DECISION |

No numeric threshold, screening cutoff, clinical interpretation, or client-facing claim may be populated by engineering or a model.

## Required approval records

Every row needs the signed external record ID and digest, signature/attestation reference, signer name and role, qualifications where relevant, exact scope, jurisdictions, signed timestamp, expiry, and any limitations. Rejection, deferral, expiry, missing signature, digest mismatch, or stale scope blocks launch.

### v1 scope reduction: SINGLE_SIGNER_ACCOUNTABLE_OWNER (S-20)

Recorded decision, `board/V1-SCOPE.md` ("Decision recorded: one signer", Jaden, 2026-09-27): **v1 ships with
one signer, the accountable owner, holding dietitian and CPT credentials.** Of the seven rows below, only
**Nutrition professional** is required by the two enforcement points
(`REQUIRED_APPROVAL_REQUIREMENTS` in `lib/ai-coach/live-launch/schema.ts` and the SQL validator
`validate_ai_coach_live_launch_approval`). The other six are optional: a packet may still carry them, and any
row it does carry is validated in full, by both enforcement points, exactly as before. Nothing else in this
document is relaxed — the twelve decision records, the nine evidence records, the five artifact bindings, the
digest binding, the expiry windows and the test-only boundary are unchanged.

This is a deliberate, recorded scope reduction, not a workaround. What v1 does without:

- **Legal/scope** — nobody reviews the client-facing clinical copy for legal exposure, and nobody
  independently attests that the packet's jurisdictions are the ones the service may operate in.
- **Provider privacy/security** — no independent sign-off on the provider data flow, retention, regional
  processing or no-training configuration. The database trigger still enforces the four configuration flags
  mechanically; what is gone is a human attesting to them.
- **SLO/spend limits** — no independent sign-off on the latency, failure-rate, token and spend ceilings. The
  ceilings are still enforced at runtime; nobody but the accountable owner has agreed they are right.
- **Operational owner, incident/referral wording, product governance** — folded into the same accountable
  owner, who is the same person.

`scripts/evaluate-ai-coach-final-provider.ts` still refuses to run without current signed
`PROVIDER_PRIVACY_SECURITY` **and** `SLO_AND_SPEND_LIMITS` approvals on the exact packet. That gate was left
as it stands on purpose: it authorizes real provider I/O against a real credential, and S-20 did not have the
authority to decide that the accountable owner's single signature covers it. Producing the
`REAL_PROVIDER_EVALUATION` evidence row therefore still requires those two approvals, or an explicit,
separately recorded decision to change that script.

| Approval                  | Required accountable signer/input                                                                                                                                                                | Record/signature        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Nutrition professional    | Qualified professional approves D01–D12, live artifacts, populations, exclusions, risks, fields/units, and tests                                                                                 | REQUIRED HUMAN DECISION |
| Legal/scope               | Counsel approves jurisdictions, scope of practice, claims, disclosures, referral/emergency language, and exclusions                                                                              | REQUIRED HUMAN DECISION |
| Provider privacy/security | Authorized vendor/security/privacy owners approve data flow, retention/deletion, regional processing, subprocessors, no-training configuration, incident terms, and final provider configuration | REQUIRED HUMAN DECISION |
| Operational owner         | Named owner accepts release, on-call coverage, paging/rollback authority, dashboards, and runbooks                                                                                               | REQUIRED HUMAN DECISION |
| SLO/spend limits          | Authorized owners approve latency/availability objectives, alert levels, timeout/retry behavior, token/spend limits, and shutdown triggers                                                       | REQUIRED HUMAN DECISION |
| Incident/referral wording | Qualified nutrition, legal, safety, and operations reviewers approve the exact incident, emergency, pause, and referral templates/runbook                                                        | REQUIRED HUMAN DECISION |
| Product governance        | Accountable release authority approves the exact release/artifact/provider/evidence index after all other signatures                                                                             | REQUIRED HUMAN DECISION |

## Required release evidence

| Evidence                    | Required bound result                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1005 artifact integrity   | Current schema, lifecycle, reference, digest, replay, and real-artifact publication evidence                                                                                             |
| T-1006 autonomy gate        | Current deterministic/fail-closed safety and candidate-validation evidence                                                                                                               |
| T-1007 provider boundary    | Current injection, tenant-isolation, timeout/retry, schema, and audit evidence                                                                                                           |
| T-1008 activation lifecycle | Current finalization, acceptance, check-in, export, and deletion evidence                                                                                                                |
| T-1009 adversarial suite    | Revision-bound corpus results and measurement records                                                                                                                                    |
| T-1010 operations drill     | Aggregate-monitoring assertions and automated rollback evidence                                                                                                                          |
| Staging kill-switch drill   | Witnessed staging disable/restore drill with named operators and timestamps                                                                                                              |
| Real-provider evaluation    | Approved evaluation of final provider/configuration, including latency, errors, privacy/security controls, token/spend behavior, and safety corpus; no raw prompts/traces in this packet |
| Full Xcode                  | Exact-revision iOS build and complete test evidence on the approved platform matrix                                                                                                      |

Every evidence record must identify the subject revision/configuration, command or controlled procedure, result, observer/attestor, record digest, observed timestamp, expiry, and signed attestation reference. Synthetic evidence may support engineering confidence but cannot substitute for real-provider, staging, legal, nutrition, or full-Xcode approval.

## Final signatures

By signing, reviewers approve only the explicitly listed scope and immutable digests; they do not approve later versions or omitted jurisdictions.

| Role                                 | Name/qualifications     | Scope and limitations   | Signed record ID/digest | Signature reference/date/expiry |
| ------------------------------------ | ----------------------- | ----------------------- | ----------------------- | ------------------------------- |
| Qualified nutrition professional     | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |
| Legal counsel                        | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |
| Provider privacy/security authority  | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |
| Named operational owner              | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |
| SLO/spend authority                  | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |
| Incident/referral wording approvers  | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |
| Product governance/release authority | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION | REQUIRED HUMAN DECISION         |

## Current decision

**LIVE LAUNCH IS NOT AUTHORIZED.** The included packet is test-only, unsigned, unbound to live artifacts, and intentionally rejected by both file-level readiness checks and the server/database lifecycle. Feature flags and public discovery remain disabled. A future approval does not itself activate anything; activation requires a separate reviewed release action that supplies the exact server-owned packet identity to the production operation gate.
