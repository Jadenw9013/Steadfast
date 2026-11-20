"use client";

import { SignOutButton } from "@clerk/nextjs";

export default function AccountEntryError({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="sf-app-shell flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <section className="w-full max-w-md space-y-5 rounded-2xl border border-white/[0.08] bg-zinc-900 p-6 text-center">
        <h1 className="font-display text-xl font-bold text-zinc-100">We couldn&apos;t open your account</h1>
        <p className="text-sm leading-relaxed text-zinc-400">Try again, or sign out and use your original email and sign-in method. You don&apos;t need to submit another coaching request. If this continues, send your coach a screenshot of this screen.</p>
        <button type="button" onClick={reset} className="sf-button-primary min-h-[56px] w-full">Try again</button>
        <SignOutButton redirectUrl="/sign-in">
          <button type="button" className="sf-button-secondary min-h-[48px] w-full">Sign out and try another account</button>
        </SignOutButton>
      </section>
    </main>
  );
}
