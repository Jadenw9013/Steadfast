import { SignIn, SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Image from "next/image";
import Link from "next/link";
import { authEntryUrl } from "@/lib/auth/entry";

export function AccountEntry({ returnTo, legacySignUp = false }: { returnTo: string; legacySignUp?: boolean }) {
  const appearance = {
    baseTheme: dark,
    variables: {
      colorPrimary: "#2563eb",
      colorPrimaryForeground: "#ffffff",
      colorBackground: "#121b28",
      colorInputBackground: "#1a2637",
      colorInputText: "#f2f6fc",
      colorText: "#f2f6fc",
      colorTextSecondary: "#aebace",
      borderRadius: "0.875rem",
      fontFamily: "var(--font-sora), sans-serif",
    },
    elements: {
      rootBox: "w-full",
      cardBox: "w-full max-w-full shadow-none",
      card: "w-full max-w-full border border-white/[0.08] shadow-none",
      headerTitle: "font-display font-bold",
      headerSubtitle: "text-zinc-400",
      socialButtonsBlockButton: "min-h-[48px] border-white/[0.12] bg-white/[0.04] text-zinc-100 transition-colors hover:bg-white/[0.08]",
      formFieldInput: "min-h-[48px] !text-[max(1rem,16px)] border-white/[0.12] text-zinc-100",
      formButtonPrimary: "min-h-[56px] bg-blue-600 !text-white font-semibold transition-colors hover:bg-blue-500",
      footerActionLink: "text-blue-400 hover:text-blue-300",
      formFieldLabel: "text-zinc-300",
      identityPreviewEditButton: "min-h-[48px] text-blue-400",
      otpCodeFieldInput: "min-h-[48px] text-zinc-100",
    },
  };

  return (
    <main id="main-content" className="sf-app-shell flex min-h-[100dvh] flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-[420px] space-y-6">
        <header className="space-y-3 text-center">
          <Link href="/" className="mx-auto flex h-14 w-14 items-center justify-center" aria-label="Steadfast home">
            <Image src="/brand/Steadfast_logo_pictoral.png" alt="" width={48} height={48} priority />
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">Welcome to Steadfast</h1>
          <p className="text-sm leading-relaxed text-zinc-400">One place to sign in or create your account.</p>
        </header>
        {legacySignUp ? (
          <SignUp routing="path" path="/sign-up" signInUrl={authEntryUrl(returnTo)} forceRedirectUrl={returnTo} signInForceRedirectUrl={returnTo} appearance={appearance} />
        ) : (
          <SignIn routing="path" path="/sign-in" withSignUp forceRedirectUrl={returnTo} signUpForceRedirectUrl={returnTo} appearance={appearance} />
        )}
        <p className="text-center text-sm leading-relaxed text-zinc-400">
          Already working with a coach? Use the email or sign-in method you used before. You don&apos;t need to request coaching again.
        </p>
        <details className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-zinc-400">
          <summary className="flex min-h-[48px] cursor-pointer items-center font-medium text-zinc-300">Trouble getting an email?</summary>
          <p className="pb-4 leading-relaxed">Check your email spelling and spam folder, then use the resend option on the verification screen. If you originally used Google or Apple, choose that same sign-in method. Never share your password or verification code.</p>
        </details>
        <details className="text-xs leading-relaxed text-zinc-400">
          <summary className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2">Medical Disclaimer &amp; Liability Notice</summary>
          <div className="space-y-2 rounded-xl border border-white/[0.08] p-4">
            <p><strong>Not Medical Advice:</strong> Steadfast provides general fitness and wellness coaching only and does not provide medical advice, clinical nutrition therapy, diagnosis, or treatment. Coaches and content reviewers are not required to hold medical or clinical credentials.</p>
            <p><strong>Consult Your Doctor:</strong> You agree that you should consult your doctor or a qualified healthcare professional before beginning any diet, training, or exercise program. You assume full risk for your participation.</p>
            <p>By creating an account, you agree to our <Link href="/terms" className="text-blue-400 underline">Terms of Service</Link> and acknowledge that Steadfast is not liable for health outcomes or injuries.</p>
          </div>
        </details>
        <nav aria-label="Account information" className="flex justify-center gap-6 text-xs text-zinc-400">
          <Link href="/terms" className="flex min-h-[48px] items-center transition-colors hover:text-zinc-100">Terms</Link>
          <Link href="/privacy" className="flex min-h-[48px] items-center transition-colors hover:text-zinc-100">Privacy</Link>
        </nav>
      </div>
    </main>
  );
}
