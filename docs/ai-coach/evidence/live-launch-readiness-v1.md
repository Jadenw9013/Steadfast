# AI Coach live-launch readiness v1

Evidence date: 2026-09-22  
Decision: **LIVE LAUNCH NOT AUTHORIZED**  
Public discovery: **NOT IMPLEMENTED / NOT ENABLED**

## Completed engineering work

- Added a versioned, signable approval packet and immutable authoring workflow. The checked-in packet is explicitly `testOnly: true`, contains `REQUIRED HUMAN DECISION` placeholders, has no live artifact bindings, and is expected to fail live readiness.
- Added a strict server-owned packet schema for D01–D12, seven expiring signed approval categories, nine expiring attested evidence categories, exact release/jurisdiction identity, and exact policy/catalog/evidence/template artifact IDs, versions, and digests.
- Added immutable DRAFT → APPROVED → REVOKED persistence and append-only lifecycle audit. PostgreSQL rejects non-DRAFT inserts, content/digest mutation, deletion, incomplete/test-only approval, invalid transitions, and reversal after revocation.
- Added repository validation that rechecks packet digest, state, effective/expiry window, signatures, external-record digest bindings, legal jurisdictions, release identity, evidence currency, policy dependency identity, artifact digests, compatibility, reference integrity, non-synthetic classification, expiry, and revocation under row locks.
- Added a production operation prerequisite. An enabled feature flag or operational control is insufficient: a production operation without an exact current server-selected packet fails with `LIVE_RELEASE_EVIDENCE_REQUIRED`. Existing fixture runtime restrictions still independently reject production and real accounts.
- Revoking a launch packet disables generation, provider, finalization, acceptance, and artifact publication. The packet cannot enable any flag, provider, route, client, or public surface.
- Preserved account-deletion behavior by deleting actor-linked launch audit records before deleting the user. Global packets contain no client data and are not exported as client data.
- Added adversarial coverage for missing/duplicate/mismatched bindings; missing/deferred D01–D12 decisions; wrong decision signer; missing, rejected, future, expired, unsigned, placeholder, wrong-release, wrong-jurisdiction, and digest-mismatched approvals; missing, failed, stale, unsigned, wrong-release, and digest-mismatched evidence; synthetic, expired, revoked, and digest-mismatched artifacts; forged lifecycle writes; and missing production packet context.

No real nutrition value, screening cutoff, clinical threshold, provider call, feature flag, public UI, claim, RAG, browsing, or activation path was added.

## Validation recorded

| Gate                                       | Result                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packet authoring/readiness drill           | PASS — schema and 11 source digests verified; packet digest `915451948c45446bcc36df293d6b5965f171ee4b3790bd34960b27c2530f4157`; intentional readiness rejection verified                    |
| Focused readiness unit tests               | PASS — 1 file, 6 tests                                                                                                                                                                      |
| Focused artifact + launch PostgreSQL tests | PASS — 2 files, 20 tests against `steadfast_security_test`                                                                                                                                  |
| Consolidated AI Coach release harness      | PASS — 41 focused unit tests, 6 kill-switch drills, and 227 tests across 26 isolated PostgreSQL files; type-check, changed-file lint/format, web build, Swift parse, and diff check passed  |
| Default regression                         | PASS — 61 files / 814 tests passed; 55 files / 542 opt-in database tests skipped because PostgreSQL coverage ran separately                                                                 |
| Synthetic browser evidence                 | PASS — draft reload, uncertainty retry, corrections, missingness, concerns, typed sets, and narrow layout                                                                                   |
| Prisma validation/generation               | PASS — Prisma 7.5.0 client generated                                                                                                                                                        |
| Disposable migration replay                | PASS — 66 preserved migrations recorded through the formal baseline; 6 forward migrations applied; all 72 current; no schema diff; legacy raw-SQL invariants present; disposable DB dropped |
| Web production build                       | PASS — 123 pages; two pre-existing generated-Prisma Edge-runtime warnings remain                                                                                                            |
| Native local validation                    | PARTIAL — Swift sources parse; full Xcode build/tests unavailable because this host selects `/Library/Developer/CommandLineTools`                                                           |

Primary reproducible command:

```sh
DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
  pnpm run ai-coach:release-evidence
```

## Required human approvals and external inputs

Launch remains blocked until a new non-test packet version contains all of the following, scoped to the exact release and five artifact digests:

1. A qualified nutrition professional completes and signs D01–D12, including evidence links, populations/exclusions, risks and uncertainty, exact artifact fields/units, and post-approval tests. This includes every live screening cutoff, energy/rate/adjustment limit, no-consecutive-deficit interpretation, and referral condition.
2. Jurisdiction-specific counsel signs the allowed scope, exclusions, claims/disclosures, and exact emergency/referral/pause wording for every listed jurisdiction.
3. Authorized provider privacy/security owners approve the selected vendor/configuration, data flow, regional processing, subprocessors, retention/deletion, no-training controls, incident terms, and security posture.
4. A named operational owner accepts on-call and rollback authority. Authorized owners approve live SLOs, alerts, timeouts, retries, token/spend limits, dashboards, retention, and shutdown triggers.
5. Named safety/legal/nutrition/operations owners approve the incident and referral runbook and wording.
6. A witnessed staging kill-switch/rollback drill produces current signed evidence for the exact release.
7. A controlled real-provider evaluation produces approved, current evidence for the final provider configuration without placing raw prompts, traces, client data, or secrets in the packet.
8. Full Xcode CI produces build and complete test evidence for the exact iOS revision and approved platform matrix.
9. Reviewed, non-synthetic T-1005 policy, food, exercise, evidence, and escalation-template artifacts are authored and published with qualified review/legal metadata and exact mutual references.
10. Product governance signs the final immutable packet only after every prior record is current. A separate governed release action would still be required; packet approval alone never activates coaching.

## Safe resume commands

After humans supply the required records, create a new packet version and run:

```sh
pnpm exec tsx scripts/validate-ai-coach-live-launch-packet.ts \
  --draft docs/ai-coach/approval/<candidate>.json
pnpm exec tsx scripts/validate-ai-coach-live-launch-packet.ts \
  --readiness docs/ai-coach/approval/<candidate>.json

DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
SECURITY_INTEGRATION=1 AI_COACH_FIXTURE_MODE=true \
FEATURE_AI_COACH_ENROLLMENT=false FEATURE_AI_COACH_GENERATION=false \
FEATURE_AI_COACH_PUBLICATION=false \
pnpm exec vitest run tests/integration/ai-coach-*.test.ts \
  tests/integration/account-deletion.test.ts \
  --maxWorkers=1 --no-file-parallelism --reporter=dot

DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_migration_replay_<unique> \
  pnpm run prisma:replay

cd ../ios-steadfast
bash scripts/validate-ai-coach-release.sh --require-xcode
```

Then re-run the consolidated harness and obtain the final product-governance signature. Do not enable flags or controls during evidence collection. Registration/approval must occur only through the governed server repository; live activation remains a separate stopped path until all records above are present.
