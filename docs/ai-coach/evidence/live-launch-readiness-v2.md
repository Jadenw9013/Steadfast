# AI Coach activation-blocked engineering evidence v2

Evidence date: 2026-09-23  
Decision: **LIVE LAUNCH NOT AUTHORIZED**  
Public discovery: **IMPLEMENTED BUT SERVER-HIDDEN WITHOUT A CURRENT ACTIVE RELEASE**  
Provider I/O performed: **NONE**

## Candidate identity

- Web base revision: `839d8fc3b454cb9c1b66e21d8b245581c75a282c`
- iOS base revision: `c25ba7af8847a20014f6b3ba968fee0475a382f3`
- Candidate status: working-tree implementation, not an immutable release revision and not signable launch evidence yet.
- Checked-in launch packet digest: `bd5535638ce51afa36c512d16b26c13fc1a0e8b587d883c25c169aea325e8379`
- Checked-in launch packet state: schema-valid authoring draft; `testOnly: true`; no runtime configuration, live artifacts, signatures, or current external evidence.

## Passed engineering evidence

| Gate                                     | Result                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consolidated release-evidence harness v2 | PASS with live flags disabled and synthetic provider only                                                                                                                                                                                               |
| Focused unit/security corpus             | PASS — 6 files / 46 tests                                                                                                                                                                                                                               |
| Kill-switch/rollback drill               | PASS — 6 tests                                                                                                                                                                                                                                          |
| Isolated PostgreSQL AI Coach suite       | PASS — 26 files / 231 tests against only `steadfast_security_test`                                                                                                                                                                                      |
| Approved-staging lifecycle simulation    | PASS — isolated non-live fixtures cover DRAFT → APPROVED → ACTIVE → DEACTIVATED → REVOKED; direct activation insert and expired/revoked activation fail closed                                                                                          |
| Default web regression                   | PASS — 63 files / 820 tests; 55 files / 545 opt-in database tests skipped in this default run because PostgreSQL coverage ran separately                                                                                                                |
| Prisma schema and client                 | PASS — validation and generation with Prisma 7.5.0                                                                                                                                                                                                      |
| Empty-schema migration replay            | PASS — 66 preserved historical migrations resolved through the formal baseline, 7 forward migrations applied, all 73 current, no Prisma schema diff, legacy raw-SQL invariants present; disposable database removed                                     |
| Web type-check/lint/format/diff          | PASS — TypeScript, every changed TypeScript/TSX file, focused formatting, and whitespace checks                                                                                                                                                         |
| Web production build                     | PASS — 123 pages; two pre-existing generated-Prisma Edge-runtime warnings remain                                                                                                                                                                        |
| Provider boundary                        | PASS — strict schema, direct-identifier rejection, zero tools/browsing/RAG/cross-client memory, public-HTTPS gateway validation, bounded timeout/retry/token limits, minimized request, strict output, aggregate latency/retry/token/spend measurements |
| Discovery/onboarding                     | PASS — packet-owned copy only, complete consent-configuration digest, inaccessible without the sole current persisted activation, no public fallback, accessible landmark/control contract                                                              |
| Staging/provider preflight guards        | PASS — placeholder packet and test-only provider evaluation were rejected before deployment, credential access, or provider I/O                                                                                                                         |
| Native local validation                  | PASS/PARTIAL — all AI Coach Swift sources parse and accessibility/server-localized-copy checks pass; full Xcode simulator build/tests were unavailable because only Command Line Tools are selected                                                     |
| Knowledge graph                          | PASS — graph rebuilt after web code changes (2,110 nodes, 2,003 edges, 552 communities)                                                                                                                                                                 |

No live provider call, production/staging deployment, feature enablement, live artifact publication, real nutrition value, screening cutoff, medical threshold, claim, public activation, web browsing, or RAG occurred.

## Evidence that remains external

Every item in [`LAUNCH_REQUIRED_INPUTS.md`](../../../LAUNCH_REQUIRED_INPUTS.md) remains mandatory. In particular, the current evidence does not supply or imply qualified nutrition approval, legal approval, provider/vendor privacy or security approval, an operational owner or approved SLO, emergency/referral wording, witnessed staging evidence, real-provider evaluation, full-Xcode evidence, product governance, production infrastructure approval, or signatures. The working trees must first become immutable release revisions and all approvals/evidence must bind those exact revisions, the five live artifact digests, and the runtime-configuration digest.

The only future activation mechanism is the CLI command in `LAUNCH_REQUIRED_INPUTS.md`. It cannot author, approve, repair, or infer a missing record. Any missing, stale, unsigned, expired, revoked, incompatible, test-only, or digest-mismatched input leaves discovery hidden and operations blocked.
