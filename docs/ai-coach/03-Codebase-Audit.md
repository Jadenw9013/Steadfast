# Codebase audit and remediation

Baseline: [Steadfast commit bda25ea](https://github.com/Jadenw9013/Steadfast/tree/bda25ea4673b47ccc4c302cb6becbcbad0842d3a), reviewed September 13, 2026. Paths and line spans below refer to that commit. This is static source inspection: no live exploit, application test, production incident investigation, or external infrastructure audit was performed. Severity describes the identified behavior and stated preconditions, not an assertion that harm occurred.

The existing Next.js/TypeScript/Prisma backend, identity integration, private storage, human coaching screens, API routes and tests are reusable. Repair authorization and history integrity before live AI enrollment. Implement the slices in [08-Implementation-Backlog.md](08-Implementation-Backlog.md); use [05-API-and-State-Contracts.md](05-API-and-State-Contracts.md) for authoritative new contracts.

## Audit priorities

| Finding | Severity | Scope | Slice |
|---|---|---|---|
| CB01 Coach-controlled linking grants existing-account access | Critical | Current authorization | F02 |
| CB02 Legacy ownership guards omit deactivation | High | Current authorization | F01 |
| CB03 Messages lack conversation boundaries | High | Current privacy and provider transfer | F03 |
| CB04 Published meal plans remain mutable | High | Current integrity | F04 |
| CB05 Published training plans remain mutable | High | Current integrity | F05 |
| CB06 Multiple relationships and unordered provider selection | High | AI integration prerequisite; existing ambiguity | F02, A01 |
| CB07 Check-in action/API divergence, photo loss, template scope | Medium; AI ingestion blocker | Current correctness | F06 |
| CB08 Unknown logging data can become false evidence | Medium; AI adaptation blocker | Current logging and AI inputs | F07, A08 |
| CB09 Media cleanup loses replaced object references | Medium | Privacy/retention | F08, A02 |
| CB10 Permissive flags and insufficient AI scheduling | AI release blocker | New feature infrastructure | A01, A05 |
| CB11 Billing event order can regress local state | Medium | Existing billing; paid AI later | P01 |
| CB12 Sensitive diagnostics and stale instructions | Medium privacy / Low docs | Current maintainability | F00, F08 |

## CB01 — Existing-account linking lacks client acceptance

`addLeadManually` accepts coach-supplied email/phone (`app/actions/coaching-requests.ts:857–901`). `bypassPipelineAndActivate` checks that the lead belongs to that coach and calls the linking helper (`714–755`). `lib/activation.ts:53–78` resolves an existing User by that email or partial phone match and creates CoachClient directly. No acceptance by the resolved client is required in this chain. Assignment-gated routes then allow client snapshot/message reads (`app/api/coach/clients/[clientId]/route.ts:26–35,40–78`; `app/api/messages/route.ts:39–47,69–86`).

**Preconditions:** signed-in coach with a CoachProfile, an existing account's matching email or stored phone, and access to these actions. The static call chain supports unintended access; it was not executed against real data.

**Repair:** coach activation can advance pipeline state but cannot grant account access. Require acceptance by the exact active client of an expiring invitation bound to the coach/account/scope. Remove phone-match authorization. Route every relationship writer through the same service, including `lib/auth/roles.ts:80–113` JIT creation, `lib/activation.ts`, duplicate coaching-request branches, `app/actions/client-invites.ts`, and `app/api/client/connect-coach/route.ts`. Authentication must not silently activate an approved lead. Lock the persistent client User row first, then context; atomically consume acceptance, store receipt and establish the authorized provider transition. Audit existing provenance read-only before choosing remediation; do not bulk revoke or guess historical consent.

**Required regression:** coach-entered victim email plus activation grants no access until the intended client accepts; wrong-user, expired, replayed and partial-phone attempts fail; valid acceptance succeeds once.

## CB02 — Deactivation is bypassed by legacy coach guards

`lib/auth/roles.ts:21–29` rejects inactive users. Both ownership helpers instead call Clerk auth, load User, check `isCoach` and assignment, omitting `isDeactivated` (`lib/queries/check-ins.ts:311–348`). They protect plan/intake/review actions. Deletion leaves rows during a grace period and marks User inactive (`app/actions/account-deletion.ts:101–116`).

**Preconditions:** inactive coach still has a valid Clerk session and assignment; direct action invocation bypasses layout navigation. Repair both helpers through active-account authorization and explicit CoachClient selection. Preserve intentional dual-role capability semantics. Test active assigned success and unauthenticated/inactive/non-coach/unassigned denial directly at action and API boundaries.

## CB03 — Private messages are client-wide

Message has clientId/senderId/weekOf but no conversation (`prisma/schema.prisma:307–319`). `lib/queries/messages.ts:3–24`, general API (`app/api/messages/route.ts:69–86`) and coach weekly API (`app/api/coach/clients/[clientId]/messages/route.ts:26–48`) fetch client-wide history after current assignment checks. Leaving a coach deletes only the relationship (`app/actions/coach-client.ts:53–70`). A successor or second assigned coach can therefore receive earlier correspondence through these paths.

Add participant-scoped conversations and consistent read/write/block/report/notification authorization. Keep the client's own archive. A provider switch does not authorize sharing prior private messages. Backfill only unambiguous history; client-authored rows do not identify their recipient, so uncertain segments become client-only archives. Test A→client→B transitions across every API and server-rendered query, not only the new UI. Existing “unread” counts merely detect messages from someone other than the coach (`lib/queries/messages.ts:27–40`); add real read state separately.

## CB04–05 — Published content is not immutable

Meal action fetches status but does not enforce DRAFT before replacement (`app/actions/meal-plans.ts:121–161`); meal PUT repeats this (`app/api/coach/clients/[clientId]/meal-plan/route.ts:324–362`). Draft version allocation uses read-max-plus-one without a schema uniqueness constraint (`meal-plans.ts:43–49`; `schema.prisma:269–285`).

Training save selects any current-week status, demotes the record to DRAFT and replaces content; metadata commits outside the content transaction (`app/actions/training-programs.ts:55–112`). Training PUT also fetches status without rejecting published content (`app/api/coach/clients/[clientId]/training/route.ts:285–325`).

Enforce draft-only mutation inside one transaction, including metadata and children; editing published content creates a separate draft. Use optimistic revision plus locked/conditional status checks against simultaneous publish. Audit duplicate meal version numbers before adding a constraint and serialized allocation. Test direct published-ID edits, save/publish races, concurrent drafts and transaction failure. The client must retain the prior published plan while a new draft is edited. AI canonical plans use their own immutable payloads and never write these legacy tables.

## CB06 — Active provider is ambiguous

CoachClient uniqueness covers coach/client pairs, not client alone (`schema.prisma:150–166`); multiple coaches are possible. Client messages, check-ins and default templates use unordered first-assignment selection. Introduce the sole `ClientCoachingContext` authority from document 05, with explicit active relationship and revision. Preserve historical relationships; mark ambiguous accounts `resolutionRequired` rather than guessing or deleting. All legacy transitions must use the same transaction boundary. Test AI enrollment versus human acceptance, reassignment versus plan acceptance, and stale workers after a switch. History permissions remain separate from current plan ownership.

## CB07 — Check-in transport behavior differs

The action requires weight and supports owned photos/template snapshots (`app/actions/check-in.ts:18–79`; `lib/validations/check-in.ts:3–11`); API permits missing weight/bodyFatPct but no template snapshot (`app/api/client/checkin/route.ts:12–20,31–73`). Both require a human relationship. API metric overwrite deletes existing photo rows without replacement (`100–114`). Action template lookup accepts a supplied ID without coach ownership validation (`app/actions/check-in.ts:55–68`).

Use shared validation/domain services. Distinguish “photos unchanged” from explicit replacement; validate active template ownership/version. Add source revisions because same-day overwrite changes an existing CheckIn ID. Test web/API parity, metric-only photo preservation, foreign-template rejection and stale input correction. Preserve intentional multiple submissions per day; obsolete docs do not justify a weekly uniqueness constraint. AI check-ins require AI context, not a fake human assignment.

## CB08–12 — Targeted supporting fixes

- **Unknown evidence:** `lib/queries/adherence.ts` maps absent daily records to zero meals/false workout completion; these are not verified nonadherence. `ExerciseResult` uniqueness uses exercise name/day/set/week (`schema.prisma:1045`), so repeated sessions collide. F07/A08 preserve UNKNOWN, explicit units, stable exercise IDs and distinct session IDs. See document 07 for current display/input issues.
- **Lost media references:** overwrite deletes photo rows, while purge enumerates only current rows (`lib/account-deletion/purge.ts:224–245`). Capture old owned paths in a durable cleanup outbox before unlinking. Retry storage removal and include unattached uploads/AI media in deletion. External storage lifecycle settings were not inspected. Test replacement, cleanup failure/retry and in-flight job cancellation during account deletion.
- **Flags/scheduling:** `lib/flags/check.ts:1–7` defaults unspecified features to true. AI enrollment/generation/publication flags must default OFF and be checked server-side. `vercel.json:1–8` schedules only a daily reminder run. Implement the authenticated minute sweep and deployment capability gate in A05; do not infer AI worker capacity from existing cron. The reminder endpoint already validates a bearer secret (`app/api/cron/checkin-reminders/route.ts:13–31`); preserve that pattern.
- **Billing ordering:** signature/event-ID checks exist, but subscription payloads unconditionally overwrite local state (`app/api/webhooks/stripe/route.ts:31–86`; `lib/billing.ts:61–85`). An older accepted payload arriving later can regress entitlement; duplicate handlers can perform effects before the receipt insert. Add serialized authoritative reconciliation and ordering/retry tests before extending paid billing. Pilot AI entitlement is separate from CoachSubscription and does not require new checkout.
- **Diagnostics/docs:** dashboard reads log client email/storage path (`lib/queries/check-ins.ts:184–187`). Remove sensitive routine diagnostics. CLAUDE.md and uploaded guides contradict current test availability, schema uniqueness, package-manager commands and migration procedures. F00 reconciles supported commands and isolated migration workflow; it does not execute migration commands against a live datasource.

## Handoff constraints

These findings identify focused repairs, not a mandate to rewrite the platform. Split work into reviewable slices, retaining working human coaching and native-compatible APIs. A coding agent must produce regression evidence for each repaired behavior; this planning pack does not claim those tests passed. Recheck references against the working branch before coding, since a later commit may already fix a finding.
