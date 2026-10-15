# T-1009 synthetic validation record

Scope: deterministic synthetic/demo behavior only. This record is not clinical validation and does not authorize live use.

The automated matrix covers:

- APPROVE, HOLD, FOCUSED_CLARIFICATION and PAUSE_REFER deterministic outcomes;
- flagged/unknown screening, contraindications, reviewed calorie/rate hooks and consecutive-deficit enforcement;
- missing, expired, incompatible, revoked and digest/reference-mismatched artifacts;
- forged synthetic eligibility, cross-client candidates and prompt-injection/provider authority attempts;
- provider timeouts, bounded retries, invalid output, invented IDs and concern-driven caution;
- reviewer bypass attempts, forged automatic approvals, stale revisions/sources and atomic acceptance;
- lifecycle publication/revocation, governance authorization, kill switches and aggregate-only monitoring;
- export and account-deletion handling for the new client-scoped audit records; and
- safe web/native proposal states that hide instructions until automatic authorization.

The isolated PostgreSQL gate must use only:

`postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test`

Synthetic fixtures deliberately use test-only values and synthetic reviewer identities; passing tests must not be represented as evidence of safety, efficacy, legal compliance or live readiness.

## Recorded local validation — 2026-09-22

Fixture compatibility target: `ai-coach-artifact-engine-v1`. The constrained provider identifies itself only as `SYNTHETIC_CONSTRAINED_PROVIDER_ONLY` and performs no network or model call.

| Gate                                          | Command                                                                                                                                                                                                                                       | Result                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default regression                            | `pnpm vitest run --reporter=dot`                                                                                                                                                                                                              | PASS — 58 files and 789 tests passed; 53 files and 530 database-gated tests skipped.                                                                                                                                                 |
| Isolated PostgreSQL AI Coach/account deletion | `SECURITY_INTEGRATION=1 AI_COACH_FIXTURE_MODE=true DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test pnpm vitest run tests/integration/ai-coach-*.test.ts tests/integration/account-deletion.test.ts --reporter=dot` | PASS — 24 files and 215 tests passed.                                                                                                                                                                                                |
| Prisma schema/client                          | `pnpm prisma validate` and `pnpm prisma generate`                                                                                                                                                                                             | PASS.                                                                                                                                                                                                                                |
| Static/build                                  | `pnpm type-check`, changed-file ESLint/Prettier, `pnpm build`, and `git diff --check`                                                                                                                                                         | PASS. The build retains the existing generated-Prisma Edge-runtime warnings for `node:path` and `node:url`.                                                                                                                          |
| Native syntax                                 | `swiftc -parse` on all changed AI Coach Swift files                                                                                                                                                                                           | PASS.                                                                                                                                                                                                                                |
| Native build/tests                            | `xcodebuild -list -project steadyfast.xcodeproj`                                                                                                                                                                                              | BLOCKED — the host selects Command Line Tools rather than a full Xcode developer directory, so iOS build/UI-test evidence is not claimed.                                                                                            |
| Migration replay                              | `DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_migration_replay_test pnpm run prisma:replay` against a clean disposable local database                                                                                         | PASS — the formal legacy baseline recorded 66 preserved historical migrations, deployed all five later AI Coach migrations, reported the database up to date and produced zero Prisma schema diff. No deployed database was changed. |

Known limits: this is deterministic local synthetic evidence, not staging evidence, clinical validation, qualified nutrition review, legal approval, provider privacy/security approval, real-user research or production-readiness evidence.
