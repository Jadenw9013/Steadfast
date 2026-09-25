import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAiCoachPublicDiscoveryOffer } from "@/lib/ai-coach/discovery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Coach | Steadfast" };

export default async function AiCoachDiscoveryPage() {
  const offer = await getAiCoachPublicDiscoveryOffer();
  if (!offer) notFound();
  return (
    <main id="main-content" className="min-h-[100dvh] bg-black px-5 py-16 text-zinc-100">
      <article
        aria-labelledby="ai-coach-heading"
        className="mx-auto max-w-2xl space-y-8 rounded-3xl border border-blue-500/20 bg-blue-950/20 p-6 sm:p-10"
      >
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-400">
            {offer.serviceLabel}
          </p>
          <h1 id="ai-coach-heading" className="text-3xl font-semibold sm:text-4xl">
            {offer.headline}
          </h1>
          <p className="text-lg leading-8 text-zinc-300">{offer.summary}</p>
        </header>
        <section aria-labelledby="eligibility-heading" className="space-y-3">
          <h2 id="eligibility-heading" className="text-xl font-semibold">
            {offer.informationHeading}
          </h2>
          <p className="leading-7 text-zinc-300">{offer.eligibilitySummary}</p>
          {offer.disclosureParagraphs.map((paragraph) => (
            <p key={paragraph} className="leading-7 text-zinc-300">
              {paragraph}
            </p>
          ))}
        </section>
        {offer.pricing && (
          <p className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-zinc-200">
            {offer.pricing.displayText}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sign-in?redirect_url=/client/ai-coach/start"
            className="sf-button-primary inline-flex min-h-14 items-center justify-center rounded-xl px-5 text-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {offer.continueLabel}
          </Link>
          <Link
            href="/coaches"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 px-5 text-center text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {offer.humanCoachLabel}
          </Link>
        </div>
        <p className="text-sm text-zinc-500">
          <a className="underline underline-offset-4" href={offer.privacyNoticeUrl}>
            {offer.privacyNoticeLabel}
          </a>
        </p>
      </article>
    </main>
  );
}
