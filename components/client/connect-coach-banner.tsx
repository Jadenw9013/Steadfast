import Link from "next/link";

/**
 * Previously this component contained a coach code entry form.
 * Coach codes have been replaced by the Marketplace request flow.
 * Clients find coaches via /coaches and submit a request directly.
 */
export function ConnectCoachBanner() {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 dark:border-zinc-800/80 dark:bg-[#0a1224]">
      <h2 className="text-base font-semibold">Find a Coach</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Browse verified coaches, read reviews, and request coaching directly.
      </p>
      <Link
        href="/coaches"
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.97]"
      >
        Explore Coaches
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </Link>
    </div>
  );
}
