# Steadfast engineering release evidence — 2026-09-14

**Release decision: NOT READY for live AI coaching or App Store submission.**
The remaining core AI workflow is implemented in the web/backend and native iOS
repositories, with synthetic local engineering evidence. This is not a clinical
approval, a completed real-user study, a deployed integration test, or an App
Store acceptance. Feature flags remain closed for live AI; the runtime explicitly
rejects production use of the synthetic policy/catalog.

## Implemented since the Claude handoff

- Atomic, revision-bound acceptance with permanent receipts, slots and outbox.
- Intake, independent safety reporting, consent, initial preparation, worker
  fencing, bounded manual retries, permitted current-plan reads and proposals.
- Macro/meal representation, validated equivalent swaps and ingredient totals.
- Revisioned private check-ins and typed strength/cardio sessions, missingness,
  draft/resume/correction/deletion, and immediate concern handling.
- Coordinated synthetic weekly controller, frozen evidence, exact deterministic
  proof, cooldown/cumulative bounds and fresh evidence after reviewed clearance.
- Assigned reviewer scope/capacity, exact-state approvals, audited scoped safety
  resolution and operational visibility. No self-grant endpoint exists.
- Provider-aware web/native navigation and legacy plan boundaries; serialized
  human/AI transitions; disabled legacy consent-free enrollment helper.
- Private paginated export and native explicit download/share; no actionable AI
  offline cache; refresh fencing and account-scoped screen/request state.

## Final local verification

| Check | Result | Evidence |
|---|---|---|
| Web TypeScript | PASS | `/private/tmp/steadfast-final-type.log` |
| PostgreSQL integration | 219 PASS in 6.70 s | `/private/tmp/steadfast-final-integration.log` |
| Unit suite | 428 PASS in 3.42 s | `/private/tmp/steadfast-final-unit.log` |
| Lint | Existing baseline: 14 errors, 64 warnings; no new findings | `/private/tmp/steadfast-final-lint.log` |
| Web production build | PASS | `/private/tmp/steadfast-final-build.log` |
| Browser form workflow | PASS | `/private/tmp/steadfast-parity-browser.log`; screenshots in `/private/tmp/steadfast-evidence-qa/` |
| Native Debug tests | 24 unit + 2 AI UI PASS | `/private/tmp/steadfast-ios-parity-tests.log` |
| Native Release simulator | PASS for both simulator architectures; DEBUG fixture selector absent from executable | `/private/tmp/steadfast-ios-parity-release.log` |

The ordinary unit command skips integration tests and four pre-existing smoke
checks; integration was run separately with its required local database flag.
No new lint finding is being waived. The repository-wide baseline is still debt,
not a clean lint pass. No clinical holdout or real-data pilot test was performed.

## Evidence interpretation

Tests use only the isolated local `steadfast_security_test` database. Backend
fixtures do not manufacture real reviewer qualifications or clinical methods.
Native UI tests use a DEBUG-only, network-free fixed synthetic transport. The web
browser harness mounts the real forms with synthetic HTTP responses. Neither is
an authenticated deployed web-to-iOS staging journey.

| Gate | Engineering evidence | Remaining release evidence |
|---|---|---|
| V01 | Auth/inactive ownership checks, API boundaries, acceptance regressions | Deployed session/token checks on target environments |
| V02 | Human relationship isolation and provider-scoped plan reads | Reviewed historical provenance/backfill (G07) |
| V03 | Immutable publication and concurrent acceptance suites | Staging migrations and production provenance |
| V04 | Shared observation/session commands, full beginner command journey | Native/web authenticated uploads and staging network failures |
| V05 | Missing values, explicit units, distinct sessions/sets and corrections | Real beginner comprehension study |
| V06 | Calendar windows/DST tests and durable retry machinery | Actual scheduler/device delivery across timezone transitions |
| V07 | Account purge, cleanup outbox and evidence deletion suites; owner export cancellation | Approved retention policy and deployed purge/storage audit |
| V08 | Real concurrent AI enrollment/human acceptance; inactive/current-invite checks | G07 backfill and real account transition acceptance |
| V09 | Unsupported intake, policy/catalog references and permissions fail closed | Approved population/method/input mapping (G01/G02) |
| V10 | Worker leases/fencing, retries, crash recovery and current-state checks | Hosted scheduler duration, recovery and live provider measurements |
| V11 | Same prescription across macro/meal and validated swaps; no human-plan writes | Reviewed ingredient/recipe coverage and purchase yields |
| V12 | Synthetic nutrition ADJUST from shipped observation fields with deterministic proof | Qualified policy and adjudicated real-world holdouts |
| V13 | Permanent routine slot, cooldown/history and representation regressions | Supervised pilot trajectory evidence |
| V14 | Concurrent acceptance, stale base/revisions and permanent replay regressions | Deployed multi-device acceptance/network-drop checks |
| V15 | Correction/deletion source hashes; ordinary post-cutoff logs preserve proposals | Real offline correction/purge race evaluation |
| V16 | Closed-window rejection and calendar evidence bounds | Hosted scheduler/window transition acceptance |
| V17 | Independent invalid-form concerns, monotonic restrictions, audited resolution | Named escalation staffing and clinically reviewed responses |
| V18 | Assigned capabilities, queue cap, exact review hashes and revoked-grant rejection | Real qualifications, assignment consent and service coverage |
| V19 | Synthetic unknown-catalog/allergy, prompt-injection and controller-bound tests | Independent adjudicated adversarial/ordinary holdouts; clinical false-acceptance and over-refusal rates |
| V20 | Full shared-command beginner journey; browser draft/retry/correction; native plan/draft UI tests | Consented beginner study and authenticated web/iOS staging journey with drops at every boundary |

## Cost and latency

No live model calls were made by this evaluation. Live inference cost, latency,
clinical false-acceptance and over-refusal are **not measured**. Synthetic test
runtime is a software validation measurement, not a production SLO or benchmark.
Run logs include actual test durations. Resource contention caused test timeouts
when Xcode compilation and broad suites ran simultaneously; final verification
must run these heavy jobs sequentially, with integration workers bounded to four.
No test timeout was increased to hide a failure.

## Remaining product/release work

1. G01/G02: reviewed numerical policy, intended population, real catalog,
   allergen/nutrient/recipe feasibility, preparation instructions, demonstrations,
   practical food/cooking/storage/cultural coverage and adjudicated holdouts.
   Current fixture examples cannot stand in for this content or its constraints.
2. G03/G04: actual privacy/retention/claims/geography decisions and named qualified
   reviewers, service hours, escalation and absence procedures.
3. G05/G07: deploy reviewed migrations/backend contracts to staging; verify
   scheduler, real model configuration and caps, source-data provenance and
   monitoring owners. Acceptance notification outbox is intent only: delivery is
   unconfigured and must be designed/tested before claiming notifications work.
4. G06: consented usability study and supervised-pilot outcomes. Local UI tests
   cannot establish real safety, comprehension or efficacy.
5. Native launch: authenticated staging QA, physical-device checks, release
   signing/archive, accurate App Store metadata/privacy declarations and review
   account, then submission. No upload or signing was performed here.
6. G08/G09 apply before new paid checkout or broader autonomous rollout; existing
   invited fixture entitlements are not an approved commercial offering.

These are unfinished gates, not approvals inferred from passing tests. See
`../13-Sources-and-Open-Decisions.md` for required owners and artifacts.
