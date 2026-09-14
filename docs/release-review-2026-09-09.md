Steadfast security and iOS release review — September 9, 2026

**Recommendation: hold App Store submission until the P1 findings below are resolved.**

Reviewed the current working copies of `/Users/jadenwong/Dev/Steadfast` and `/Users/jadenwong/Dev/ios-steadfast`, including their existing uncommitted changes. These findings describe local source, not proof that every change is deployed. No application source was changed and no production mutation, purchase, message, or deletion was performed.

**How the projects connect**

The native SwiftUI app sends Clerk session JWTs as Bearer tokens to `https://steadfast-coaching.com/api/...`. The Next.js web project implements those REST endpoints as well as web-only Server Actions. Both paths use Prisma and the same PostgreSQL data model. The server uses privileged Supabase access to upload files and issue signed download URLs; the iOS app does not need a Supabase service-role key. Clerk webhooks synchronize identity records. Additional integrations include APNs, Twilio, Resend, OpenAI/Google Vision, and the newly added Stripe coach subscription flow.

The main architectural problem is duplicated behavior between web Server Actions and iOS REST endpoints. Security fixes and features on one path do not consistently reach the other. Deletion and blocking are concrete examples.

Evidence: [iOS request/authentication code](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Services/APIService.swift:105), [release API configuration](/Users/jadenwong/Dev/ios-steadfast/Config.Release.xcconfig:19), [backend identity resolution](/Users/jadenwong/Dev/Steadfast/lib/auth/roles.ts:21).

**Findings, ordered for remediation**

1. **P1 — Upgrade the vulnerable Next.js dependency before release.**

   The web project pins Next.js 16.1.6 and uses App Router Server Actions. This matches the conditions and affected range of GHSA-m99w-x7hq-7vfj / CVE-2026-64641: crafted requests can consume excessive CPU and block requests in the process. Both web and iOS depend on this backend. The advisory fixes that issue in 16.2.11. A newer image-optimization advisory, GHSA-2xp9-vwfh-vxw4, lists versions below 16.3.3 as affected by AVIF-related remote code execution; production exposure to that second issue depends on the actual hosting/image-processing path and was not tested. Upgrade to a maintained patched version covering both advisories, update the chosen lockfile, and rebuild. Do not interpret this as evidence of an existing compromise.

   Evidence: [package.json](/Users/jadenwong/Dev/Steadfast/package.json:38), [Next.js DoS advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj), [Next.js image advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).

2. **P1 — iOS account deletion and cancellation call nonexistent endpoints.**

   The app posts to `/api/actions/account-deletion` and `/api/actions/account-deletion/cancel`. Neither route exists, and there is no rewrite implementing them. The web implementation is a Server Action, which does not automatically expose these REST URLs. The visible iOS deletion flow therefore cannot fulfill its request against this backend. Additionally, `/api/me` omits `isDeactivated` and `deletionRequest`; the Swift decoder defaults these to false/nil, so simply adding the routes will not fix the pending-deletion screen.

   Implement authenticated REST handlers sharing the web deletion service, return the account lifecycle fields from `/api/me`, and verify request → pending state → cancel → restored state in the app. Apple requires apps that create accounts to provide in-app initiation of deletion.

   Evidence: [mobile deletion calls](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Services/SteadfastAPI.swift:744), [web deletion action](/Users/jadenwong/Dev/Steadfast/app/actions/account-deletion.ts:17), [me response](/Users/jadenwong/Dev/Steadfast/app/api/me/route.ts:40), [Swift defaults](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Models/User.swift:72), [Apple deletion requirements](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

3. **P1 — The purge fails for ordinary accounts with messages, blocks, or reports.**

   Purging deletes messages only by `senderId`. A coach-authored message whose `clientId` is the deleting client remains and its restrictive foreign key prevents deletion of the User. The new UserBlock and MessageReport references also use `ON DELETE RESTRICT`, and the purge does not clean up or anonymize them. Earlier deletes are already committed, leaving a partially erased account. The purge also drops a database-wide foreign-key constraint at runtime; if User deletion fails, execution never reaches the constraint restoration.

   Replace runtime DDL with an appropriate migrated schema, perform the database phase transactionally, and handle all inbound references. Retain any justified moderation record through deliberate anonymization/retention rules. Test with coach-authored messages, both directions of blocks/reports, both user roles, and an injected mid-purge failure. The deletion sweep does run inside the scheduled check-in cron; the problem is not a missing schedule.

   Evidence: [purge message filter and User deletion](/Users/jadenwong/Dev/Steadfast/lib/account-deletion/purge.ts:236), [message constraint](/Users/jadenwong/Dev/Steadfast/prisma/migrations/20260216100000_add_messages/migration.sql:20), [moderation constraints](/Users/jadenwong/Dev/Steadfast/prisma/migrations/20260322050000_add_user_block_and_message_report/migration.sql:44).

4. **P1 — Purge can leave personal data behind while reporting completion.**

   Web progress photos are uploaded under `clerkUserId/batchId/...`, but cleanup lists only `checkInId/`. It therefore misses web-uploaded photos. Cleanup ignores returned Supabase errors and several caught failures; Clerk deletion failures are also swallowed before marking the request COMPLETED. Client purges merely null `CoachingRequest.prospectId`, retaining names, email, phone, intake answers, and associated submissions/signatures. No specific retention policy is enforced there.

   Delete using the recorded `CheckInPhoto.storagePath` values before removing database rows. Inventory all other storage paths, including banners/workout imports. Persist retryable cleanup work and only report completion once required steps succeed. Erase or anonymize prospect/intake records unless a documented retention obligation applies. Verify storage and identity removal using a disposable staging account containing uploads from both clients.

   Evidence: [web upload paths](/Users/jadenwong/Dev/Steadfast/app/actions/storage.ts:11), [photo cleanup](/Users/jadenwong/Dev/Steadfast/lib/account-deletion/purge.ts:322), [retained prospect data](/Users/jadenwong/Dev/Steadfast/lib/account-deletion/purge.ts:173), [completion despite identity failure](/Users/jadenwong/Dev/Steadfast/lib/account-deletion/purge.ts:285).

5. **P1 — Account deletion does not cancel Stripe billing.**

   Stripe subscription creation is now implemented, but cancellation in the deletion action remains a TODO and the purge never calls Stripe. Deleting a local subscription row does not stop a Stripe recurring charge. A deleting coach can lose their account while charges continue.

   Define when cancellation takes effect, cancel idempotently in Stripe, record confirmation, and keep failures retryable. Verify with Stripe test-mode subscriptions and webhook replay before shipping.

   Evidence: [unimplemented cancellation](/Users/jadenwong/Dev/Steadfast/app/actions/account-deletion.ts:93), [subscription creation](/Users/jadenwong/Dev/Steadfast/app/api/coach/billing/checkout/route.ts:30).

6. **P1 — Deactivation is enforced by web navigation, not the shared API.**

   `getCurrentDbUser()` returns an existing deactivated user without restriction. Web layouts redirect such users, but API routes generally check only authentication and role. A still-valid Clerk session can continue to call the backend and mutate data while deletion is pending. `/api/me` also hides this state from iOS, as described above.

   Add a shared active-account guard for protected operations, with an explicit allowlist for viewing/cancelling deletion and any necessary billing actions. Verify that ordinary reads/writes are rejected for deactivated users on both REST and Server Actions.

   Evidence: [shared user lookup](/Users/jadenwong/Dev/Steadfast/lib/auth/roles.ts:26), [web-only redirect](/Users/jadenwong/Dev/Steadfast/app/client/layout.tsx:17), [example message mutation](/Users/jadenwong/Dev/Steadfast/app/api/messages/route.ts:119).

7. **P1 — Web check-ins accept arbitrary private-photo paths.**

   The check-in action accepts `photoPaths` as unrestricted strings and stores them on the caller's check-in. The read path then signs those paths using privileged Supabase credentials. An authenticated client who obtains another person's object path could attach it to their own check-in and obtain a fresh download URL. Knowing an object path should not confer authorization. Exploitation requires a valid foreign path; no production path enumeration or exploit was performed.

   Bind uploads to an authenticated owner and consume only that owner's validated upload records when creating a check-in. A strict normalized ownership prefix can be an additional check. Test with two disposable clients: client A must never attach or obtain a URL for client B's photo.

   Evidence: [path input validation](/Users/jadenwong/Dev/Steadfast/lib/validations/check-in.ts:8), [unchecked attachment](/Users/jadenwong/Dev/Steadfast/app/actions/check-in.ts:148), [download signing](/Users/jadenwong/Dev/Steadfast/app/api/client/checkins/route.ts:40).

8. **P1 — Blocking a user in iOS does not stop messages through the web.**

   The REST send route checks UserBlock in both directions, but the web `sendMessage` action checks only the relationship, then creates the message and triggers notifications. The web message component still uses that action. A blocked coach/client can therefore use the web interface to continue contacting the person who blocked them.

   Move permission and block checks into one shared send service used by every entry point. Apply the agreed policy to automated check-in messages and notifications too. Test both block directions using both web and iOS, including notification suppression. This also undermines the safety feature expected for user-generated content.

   Evidence: [web send without block check](/Users/jadenwong/Dev/Steadfast/app/actions/messages.ts:47), [web caller](/Users/jadenwong/Dev/Steadfast/components/messages/message-thread.tsx:218), [REST block enforcement](/Users/jadenwong/Dev/Steadfast/app/api/messages/route.ts:170).

9. **P1 — Offline messages can display another client's conversation.**

   `getMessages(clientId:)` always writes the same `.messages` cache entry. A coach who opens client A online, then opens client B offline, can receive A's cached messages under B's conversation UI. The response has no thread identity check. The cache also is not scoped by account; existing clearing logic helps, but an old in-flight response can still write after a sign-out clear because the request code does not check an authentication generation before saving.

   Scope cache keys by authenticated account, role, endpoint, and relevant parameters, including `clientId`. Validate identity before displaying cached responses and discard stale requests after session changes. Test two-client offline navigation plus sign-out with a delayed request in flight.

   Evidence: [shared message cache key](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Services/SteadfastAPI.swift:306), [fallback and cache writes](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Services/APIService.swift:139), [coach navigation](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Features/Coach/Redesign/CoachMessagesViewV2.swift:170).

10. **P1 — Release build fails because the selected entitlements are empty.**

    The target's Release configuration selects `steadyfastRelease.entitlements`, whose dictionary is empty. The separate `steadyfastProduction.entitlements` contains production APNs, Sign in with Apple, and associated domains, but is not the selected file. The attempted Release simulator build failed with exit code 65 in the project's “Verify Release Entitlements” phase: the selected file lacks `aps-environment=production`. This is a confirmed build blocker. The existing guard is valuable: it prevents accidentally shipping the stripped configuration. Do not bypass it. Without those capabilities, push and associated-domain features would not work as intended; native Apple sign-in requires its capability too.

    Select production entitlements for the distribution configuration and verify the signed archive and provisioning profile agree. Test APNs on a real TestFlight device, Apple sign-in if offered, and association/deep-link behavior. A simulator compile cannot validate these.

    Evidence: [Release build setting](/Users/jadenwong/Dev/ios-steadfast/steadyfast.xcodeproj/project.pbxproj:488), [empty entitlements](/Users/jadenwong/Dev/ios-steadfast/steadyfast/steadyfastRelease.entitlements:5), [production capability file](/Users/jadenwong/Dev/ios-steadfast/steadyfast/steadyfastProduction.entitlements:5).

11. **P1 for affected storefronts — The Stripe subscription link needs a distribution decision.**

    Coach settings always exposes “Start Subscription,” obtains a Stripe Checkout URL, and opens it through SafariView. There is no storefront gating. This appears to sell access to Steadfast software, rather than payment to a coach for a particular live person-to-person service. Omitting the price from the native screen does not decide its policy classification. Apple's external-purchase rules differ by storefront: US links are treated differently, and exceptions/approved regional programs can apply. This is a conditional App Review risk, not a claim that every Stripe link is forbidden.

    Choose intended storefronts and document the applicable model. Use IAP where required, an eligible external-purchase program where applicable, or remove new-purchase calls to action from a qualifying companion app. The repository alone cannot establish App Store Connect territory selections or entitlement approvals.

    Evidence: [billing action and label](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Features/Coach/Settings/CoachBillingViewModel.swift:47), [Safari presentation](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Features/Coach/Settings/CoachSettingsView.swift:47), [Apple payment guidelines](https://developer.apple.com/app-store/review/guidelines/#payments).

12. **P1 — Lead intake can report success without sending anything.**

    The active lead screen calls `/api/coach/leads/{id}/intake/send`, which is absent from the web project. “Mark contacted” suppresses that error with `try?` and then displays “Intake form sent.” The dedicated send action also cannot succeed against the checked-in routes. Other unmatched routes exist in unused legacy API methods; those are cleanup work, not evidence that the current dashboard/check-in screens are broken.

    Implement or correct the active intake-send endpoint, share authorization with the existing onboarding workflow, and show success only after confirmed delivery/job acceptance. Test both buttons and an intentional server failure without sending to real customers.

    Evidence: [missing route call](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Services/SteadfastAPI.swift:1376), [false success branch](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Features/Coach/Redesign/LeadDetailViewV2.swift:663).

13. **P1 privacy review — AI sharing and deletion disclosures do not match behavior.**

    The AI editor sends the plan title, meals, extras, support content, and coach instruction to OpenAI. Those free-text fields can contain identifiable client health information. No explicit AI-sharing consent gate was found in this flow; the in-app provider list names Clerk, Supabase, and Vercel but omits OpenAI. The web list is incomplete too. Apple's guideline 5.1.2(i) requires clear disclosure and explicit permission for personal-data sharing with third-party AI. A generic AI button does not explain these recipients and data categories.

    Disclose actual processors and obtain appropriate permission before personal client data is transmitted; do not assume a coach's click supplies the client's permission. Minimize/redact payloads. Also correct the in-app claim that profile data is deleted immediately: implementation schedules deletion after 30 days. The privacy manifest has an empty collected-data list despite the app's account, fitness, photo, message, and device-token flows. Reconcile the manifest/privacy report, policy, and App Store Connect labels; the labels themselves were not inspected, and an empty manifest alone does not prove App Store rejection.

    Evidence: [AI payload and recipient](/Users/jadenwong/Dev/Steadfast/lib/llm/modify-meal-plan.ts:117), [in-app privacy policy](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Features/Legal/LegalDocumentView.swift:202), [retention claim](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Features/Legal/LegalDocumentView.swift:218), [manifest](/Users/jadenwong/Dev/ios-steadfast/steadyfast/PrivacyInfo.xcprivacy:9), [Apple privacy rules](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing).

**Additional fixes and explicit verification items**

- **P2 — Duplicate Stripe subscriptions:** checkout only fetches the existing customer ID, without rejecting an existing active subscription or using an idempotency strategy. Concurrent/repeated checkout sessions can create multiple subscriptions. A failed status fetch in iOS can also choose the “start” path. Enforce one intended subscription per coach and make lifecycle webhooks robust to repeats/out-of-order events. The hardcoded `/billing/success` and `/billing/cancel` return pages are also absent from local routes. [Checkout](/Users/jadenwong/Dev/Steadfast/app/api/coach/billing/checkout/route.ts:25).

- **P2 — Conversation boundaries need a decision:** messages are scoped only by client ID, so a newly assigned coach can read messages from the client's previous coaching relationships. There is no conversation/assignment ID or time boundary. If private conversations are intended to stay with their original participants, migrate to explicit conversations and authorize those participants. [Read query](/Users/jadenwong/Dev/Steadfast/app/api/messages/route.ts:68), [schema](/Users/jadenwong/Dev/Steadfast/prisma/schema.prisma:307).

- **P2 — Upload and AI abuse controls:** photo multipart handling has no application-level byte limit or verified image-type check and can return 201 even when all uploads fail. Signed web upload issuance accepts an unbounded filename array; the AI modification endpoint has no durable per-user rate/quota enforcement and unbounded plan arrays. Add byte/count limits, image validation, account quotas, concurrency limits, and meaningful failure responses. Supabase/Vercel limits may reduce exposure, but their production configuration was not audited. [Photo upload](/Users/jadenwong/Dev/Steadfast/app/api/client/checkin/[id]/photos/route.ts:58), [AI endpoint](/Users/jadenwong/Dev/Steadfast/app/api/mealplans/modify-plan/route.ts:9).

- **P2 — Reminder schedule disagrees with the code:** Vercel schedules the reminder cron once daily at 19:00 UTC; the code checks whether each user's configured hour equals the current server hour, assuming hourly execution. Other selected hours will not fire under this configuration. Evaluate user-local due times on a suitably frequent schedule with deduplication. [Schedule](/Users/jadenwong/Dev/Steadfast/vercel.json:5), [hour check](/Users/jadenwong/Dev/Steadfast/app/api/cron/checkin-reminders/route.ts:15).

- **P2 — Clean checkout cannot reproduce configuration without a provisioning step:** Config.xcconfig and Config.Release.xcconfig exist locally but are ignored and untracked, while Xcode references them. Provide a checked-in nonsecret template and an explicit CI configuration-generation step. The public Clerk key is not a secret. Verify minimum iOS 26.2 is intentional; it excludes older OS versions. [Ignore rules](/Users/jadenwong/Dev/ios-steadfast/.gitignore:18), [deployment target](/Users/jadenwong/Dev/ios-steadfast/steadyfast.xcodeproj/project.pbxproj:438).

- **P2 — Broken login background asset:** the Release asset compiler warns that LoginBackground refers to missing `bg.jpg`, while the actual `bg.png` is unassigned. Correct its Contents.json filename and verify the login screen image. [Asset manifest](/Users/jadenwong/Dev/ios-steadfast/steadyfast/Assets.xcassets/LoginBackground.imageset/Contents.json).

- **Verify before sign-off — Identity linking:** both JIT user creation and webhook conflict handling rebind a database account to a new Clerk ID by `email_addresses[0]`, without explicitly checking primary/verified status. Whether this is exploitable depends on enabled Clerk signup/email policies. Require a verified email and deliberate account-linking/recovery semantics, then test with unverified/secondary email addresses. [JIT rebind](/Users/jadenwong/Dev/Steadfast/lib/auth/roles.ts:32), [webhook rebind](/Users/jadenwong/Dev/Steadfast/app/api/webhooks/clerk/route.ts:58).

- **Verify before sign-off — Moderation operations:** reports are inserted into the database, but no report-review UI, alert, or resolution workflow was found in application code. Establish who receives reports, how they act, and how users reach support. Existing code alone does not establish whether an external moderation process exists. [Report handler](/Users/jadenwong/Dev/Steadfast/app/api/messages/report/route.ts:76).

**Validation and limits**

`npm run type-check` passed. `npm test -- --reporter=dot` passed 341 tests in 24 files; four tests in one file were skipped. These checks do not exercise the missing mobile endpoints, real database deletion, signed storage authorization, or payment flows. Static route comparison found nine unmatched iOS route strings; active call sites were traced before identifying user-facing defects above.

The production homepage and sign-in page loaded in the browser. The session was signed out; the visible web sign-in offers Google and email/password. Authenticated production screens were not exercised. Whether native Apple sign-in is enabled needs separate Clerk/TestFlight verification; the website's options alone do not establish the native options.

The unsigned iOS Release simulator build used Xcode 26.6 and temporary build/package directories. It failed with exit code 65 in the existing release-entitlement verification script, as described in finding 10. The asset compiler also reported the missing login background. [Build log](/private/tmp/steadfast-review-xcode.log:2238). A signed distribution archive, device testing, live Supabase bucket permissions, deployed migrations, production secrets, App Store Connect labels/territories, and end-to-end multi-account tests remain outside this review's validation. No production exploit testing was performed.

For release acceptance, prioritize shared authorization and deletion services, then add staging integration tests for deletion, foreign-photo attachment, blocked messaging, two-client offline navigation, billing duplication/cancellation, and lead-intake errors. Afterward produce a signed archive and test both coach and client accounts through TestFlight, including photos, push, Apple sign-in where offered, and deletion. Submit working review credentials and clear reviewer instructions for gated coach access.

---

**Remediation status — verified 2026-09-09, ~17:25 PT**

All 13 P1 findings and all P2/verify items were addressed in the uncommitted working trees of both repos. Verified directly (not from memory of prior notes):

- Web: `npm run type-check` clean; `npm test -- --reporter=dot` → 360 passed, 15 skipped, 0 failed (25 files, includes new `tests/integration/account-deletion.test.ts` and `tests/integration/checkout.test.ts`).
- iOS: Release-configuration simulator build → `** BUILD SUCCEEDED **` (entitlements guard now passes; `steadyfastRelease.entitlements` carries `aps-environment=production`, Apple Sign In, and associated domains). Full unit+UI test run on iPhone 17 simulator → `** TEST SUCCEEDED **`, including the new `SecurityHardeningTests`/`ScopedResponseCacheTests`/`ResponseCacheTests`.

Per finding:

1. Next.js → **fixed**, `16.3.4` (past both GHSA-m99w and GHSA-2xp9 patched versions).
2. Deletion/cancel REST endpoints → **fixed** (`app/api/actions/account-deletion/{route,cancel/route}.ts`, shared with the web action; `/api/me` now returns `isDeactivated`/`deletionRequest`).
3. Purge FK/message-ownership failures → **fixed**: `lib/account-deletion/purge.ts` now deletes messages by `senderId OR clientId`, cleans up `UserBlock`/`MessageReport`, runs the DB phase in one transaction (no runtime DDL — migrated `SET NULL` relation instead), and is retried via a `PENDING`/`PURGING` claim state machine in `lib/account-deletion/sweep.ts`.
4. Storage/identity purge completeness → **fixed**: `cleanupStorage()` now deletes by recorded `storagePath`/`storageBucket` across all buckets (profile photos, check-in photos, uploads, portfolio, testimonials, documents), storage errors now throw instead of being swallowed, and lead/intake records (`IntakePacket`, `DocumentSignature`, prospect `CoachingRequest`) are deleted rather than merely unlinked.
5. Stripe cancellation on deletion → **fixed**: `lib/account-deletion/billing.ts` (`stopAccountBilling`) is called first in `purgeUserAccount`, cancels all non-terminal subscriptions in Stripe, and records `stripeSubscriptionCancelledAt` on the deletion request.
6. Deactivation enforced only by web nav → **fixed**: `getCurrentDbUser()` now throws `"Account is pending deletion"` for deactivated users unless called with `{ allowInactive: true }`; that opt-in is scoped to layouts/deletion routes only, so REST and Server Actions share the same guard.
7. Arbitrary photo paths on check-ins → **fixed**: `lib/validations/storage-path.ts` (`isOwnedUploadPath`) rejects any path not prefixed by the caller's own ID plus traversal/encoding tricks.
8. Web messaging bypassing blocks → **fixed**: `lib/messages/permissions.ts` (`assertMessagingAllowed`) is now the single block check, used by both the REST route and the web `sendMessage` action.
9. Offline cross-client message cache bleed → **fixed**: `ResponseCache` now keys by SHA-256(accountID + full request incl. clientId), tracks a `generation` counter bumped on every sign-out/account-switch, and `APIService` double-checks both generation and current account ID before saving a response — a stale in-flight response after sign-out is discarded.
10. Release entitlements empty → **fixed and build-verified** (see above).
11. Stripe subscription storefront gating → **code-side handled**: `CoachBillingViewModel` gates the purchase CTA on `Storefront.current?.countryCode == "USA"` and presents only account-administration language (no price) via Safari, consistent with Apple's US external-purchase-link allowance. **Still open:** actually obtaining/enabling the External Purchase Link entitlement in App Store Connect is a business action outside this repo.
12. Lead intake false success → **fixed**: web route now exists at `/api/coach/leads/{id}/intake` (iOS call site updated to match, no more `/send` suffix), and `LeadDetailViewV2.runMarkContacted` no longer swallows the send error with `try?` — success is only shown after the awaited call succeeds.
13. AI privacy / deletion disclosure mismatch → **fixed**: backend now requires `privacyConsent: z.literal(true)` on the modify-plan request; iOS gates `submit()` on a new consent toggle; in-app privacy policy now lists OpenAI/Google Vision/Stripe and states the true 30-day retention window (previously claimed immediate deletion). One piece was still outstanding as of this pass and has now been fixed too: `PrivacyInfo.xcprivacy`'s `NSPrivacyCollectedDataTypes` was still an empty array — it now declares email address, name, user ID, photos/videos, fitness data, messages, and device ID, each linked/non-tracking/App-Functionality-purpose, matching the disclosed data flows.

P2 / verify-before-signoff items — all also addressed in the working tree:
- Duplicate Stripe subscriptions: fixed via row lock + Stripe-authoritative check + idempotency keys in `app/api/coach/billing/checkout/route.ts`; `/billing/success` and `/billing/cancel` pages now exist under `app/billing/`.
- Reminder schedule: cron is now hourly (`vercel.json`) and `lib/scheduling/reminder-time.ts` evaluates the user's actual timezone.
- Upload/AI abuse controls: byte/count/type limits and re-encoding via `sharp` on photo upload, shared atomic `consumeQuota()` (`lib/security/quota.ts`) rate-limiting both photo batches and AI plan modification.
- Login background asset: `Contents.json` now points at the real `bg.png`.
- Identity linking: `verifiedPrimaryEmail()` requires a verified primary email everywhere, and the Clerk webhook now returns `409` on an email collision instead of auto-rebinding the identity.
- Config provisioning template: not independently re-verified this pass.

Left open, not code fixes:
- **Conversation boundaries** (P2): still scoped by `clientId` only — this was framed as a product decision in the original finding, not changed.
- **Moderation review workflow**: still no in-app report-review UI/alerting — this is an operational process question, not something to build unprompted.

Correction: `steadyfast/steadyfastProduction.entitlements` is not orphaned — the "Verify Release Entitlements" build script's failure message explicitly tells engineers to restore production values from this file if `steadyfastRelease.entitlements` is ever stripped again. It's the intentional reference copy and is now tracked in git.

---

**Session 2 — 2026-09-09, ~17:50–18:00 PT**

- Committed both repos: `Steadfast@763b345` (61 files) and `ios-steadfast@d8cec78` (45 files), after scanning all new/untracked files for hardcoded secrets (none found) and reviewing `.env.example`/`.gitignore` diffs by hand.
- Deployed the 5 pending Prisma migrations (`npx prisma migrate deploy`) against the database in `.env.local` and regenerated the Prisma client. Confirmed first that this is the **dev/test** environment, not production — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is `pk_test_...` and no `STRIPE_SECRET_KEY` is configured at all — before touching it. `prisma migrate status` now reports the schema up to date; type-check and full test suite (360/360) still pass against the migrated schema.
- Fixed the P2 config-provisioning item for real: `Config.xcconfig` and `Config.Release.xcconfig` contain no secrets by their own header comments (Clerk *publishable* key, public production API URL, public Supabase project URL) — the `.gitignore` rule blocking them was stale. Un-ignored and committed both (`ios-steadfast@46df976`); `Config.Debug.xcconfig` was already tracked.
- Attempted a Release **archive** build (closer to the real App Store Connect pipeline than a simulator build) to look for additional signing/entitlement issues: failed only on `No profiles for 'cwd.steadyfast' were found` — expected, since automatic signing needs an Apple ID signed into Xcode with access to team `44PQPDV8QZ`, which this machine doesn't have. Confirms this step is genuinely gated on Apple Developer account access, not a code issue.

Genuinely blocked, needs you specifically:
- **TestFlight / signed archive**: needs your Apple ID signed into Xcode (or a manually installed Distribution provisioning profile) — only an "Apple Development" identity is present locally, no "Apple Distribution" identity or provisioning profiles.
- **Stripe test-mode verification**: no Stripe keys configured anywhere locally — needs your Stripe test-mode API keys in `.env.local` before checkout/cancellation/webhook-replay can be exercised.
- **App Store Connect**: External Purchase Link entitlement application (finding 11) and reviewer credentials/instructions for gated coach access — both require your ASC account.
- **Moderation workflow** and **conversation boundaries**: product decisions, not code.

Nothing further was pushed to any remote.
