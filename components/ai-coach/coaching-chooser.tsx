import Link from "next/link";
import type { AiCoachDiscoveryOffer } from "@/lib/ai-coach/discovery";
import type { AiCoachDeliveryState } from "@/lib/ai-coach/operations";

/**
 * S-34 — state-table rows 4 and 5. Rendered only when
 * `rendersCoachingChooser(provider)` is true (`lib/queries/client-provider.ts`):
 * a live discovery offer and no real provider assigned.
 *
 * Type-only imports above, deliberately: this module must stay a leaf a
 * Server Component can render without pulling `lib/db.ts` (`@prisma/adapter-pg`
 * -> `pg`) into any bundle that also needs this shape — the exact production
 * defect `lib/ai-coach/intake-contract.ts` was split out to fix (review
 * focus 3). Not `"use client"` and not `async`, so the ui-qa esbuild harness
 * can mount it directly.
 *
 * Copy budget: the three frozen strings below, plus the release-approved
 * offer DTO. `aiPreparationState` collapses to exactly one of two renders —
 * `ENABLED`, or the single neutral notice for every other value
 * (`lib/ai-coach/discovery.ts`: "Any gate failure is indistinguishable from
 * unavailable") — this component never names which non-ENABLED value it got.
 */
export type AiCoachingChooserProps = {
  offer: AiCoachDiscoveryOffer;
  aiPreparationState: AiCoachDeliveryState;
};

export function AiCoachingChooser({ offer, aiPreparationState }: AiCoachingChooserProps) {
  const prepared = aiPreparationState === "ENABLED";

  return (
    <section aria-labelledby="coaching-choice-heading" className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 id="coaching-choice-heading" className="text-2xl font-black tracking-tight text-white sm:text-3xl">
          Choose how you want to be coached
        </h1>
        <p className="text-sm text-zinc-400">No coaching provider is active on your account.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-blue-500/25 bg-blue-950/20 p-5">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-400">
            {offer.serviceLabel}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">{offer.headline}</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{offer.summary}</p>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {offer.informationHeading}
          </h3>
          <p className="mt-1 text-sm leading-6 text-zinc-300">{offer.eligibilitySummary}</p>
          {offer.disclosureParagraphs.map((paragraph) => (
            <p key={paragraph} className="mt-2 text-sm leading-6 text-zinc-300">
              {paragraph}
            </p>
          ))}

          {offer.pricing && (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-200">
              {offer.pricing.displayText}
            </p>
          )}

          {!prepared && (
            <p
              role="status"
              className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs font-medium text-amber-300"
            >
              AI coaching cannot prepare a plan right now.
            </p>
          )}

          <Link
            href="/client/ai-coach/start"
            className="sf-button-primary mt-5 inline-flex min-h-14 w-full items-center justify-center rounded-xl px-5 text-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {offer.continueLabel}
          </Link>
        </article>

        <article className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-xl font-bold text-white">Find Your Coach</h2>
          <p className="mt-3 text-sm text-zinc-400">
            Browse coaches, send a request, and get started on your fitness journey.
          </p>
          {/* S-34 review round 1, NIT: the AI card's copy (disclosures,
           * pricing) routinely makes it taller than this one; pin the CTA to
           * the bottom with layout rather than padding the card with
           * invented copy. */}
          <Link
            href="/coaches"
            className="mt-auto inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/15 px-5 text-center text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {offer.humanCoachLabel}
          </Link>
        </article>
      </div>

      <a
        href={offer.privacyNoticeUrl}
        className="inline-flex min-h-12 items-center text-sm text-zinc-400 underline underline-offset-4"
      >
        {offer.privacyNoticeLabel}
      </a>
    </section>
  );
}
