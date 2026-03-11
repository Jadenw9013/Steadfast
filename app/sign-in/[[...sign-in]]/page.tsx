import { SignIn } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Image from "next/image";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-[#020815]">
      {/* Left panel — brand / hero (hidden on mobile) */}
      <div className="relative hidden w-1/2 overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center" style={{ background: "linear-gradient(135deg, #020815 0%, #071228 50%, #0a1832 100%)" }}>
        {/* Dot mesh pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(59, 130, 246, 0.15) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Background glow effects */}
        <div className="absolute -left-20 top-1/4 h-[400px] w-[400px] rounded-full bg-blue-500/[0.07] blur-3xl" />
        <div className="absolute -right-20 bottom-1/4 h-[350px] w-[350px] rounded-full bg-indigo-500/[0.05] blur-3xl" />

        <div className="relative z-10 flex max-w-md flex-col items-center px-12 text-center">
          <Link href="/" className="mb-10" aria-label="Home">
            <div className="relative h-20 w-20">
              <Image
                src="/brand/Steadfast_logo_pictoral.png"
                alt="Steadfast"
                fill
                priority
                className="object-contain"
              />
            </div>
          </Link>

          <h1 className="font-display text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Welcome back.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-gray-500 dark:text-zinc-400">
            Your coaching workspace is waiting. Pick up right where you left off.
          </p>

          {/* Floating feature pills */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {["Weekly check-ins", "Meal plans", "Progress tracking", "Coach inbox"].map((f) => (
              <span
                key={f}
                className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-zinc-400"
              >
                {f}
              </span>
            ))}
          </div>

          {/* Scripture accent */}
          <div className="mt-16 border-t border-gray-200 pt-8 dark:border-white/[0.06]">
            <blockquote className="text-sm italic leading-relaxed text-gray-400 dark:text-zinc-500">
              &ldquo;Blessed is the one who perseveres under trial&rdquo;
            </blockquote>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">
              James 1:12
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex w-full flex-col items-center justify-center px-5 py-12 lg:w-1/2">
        {/* Mobile-only logo */}
        <Link
          href="/"
          className="mb-8 flex flex-col items-center gap-3 lg:hidden"
          aria-label="Steadfast home"
        >
          <div className="relative h-16 w-16">
            <Image
              src="/brand/Steadfast_logo_pictoral.png"
              alt="Steadfast"
              fill
              priority
              className="object-contain"
            />
          </div>
          <span className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gray-400 dark:text-zinc-500">
            Steadfast
          </span>
        </Link>

        <SignIn
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: "#3b82f6",
              colorBackground: "#0a1224",
              colorInputBackground: "rgba(255, 255, 255, 0.04)",
              colorInputText: "#e5e7eb",
              colorText: "#e5e7eb",
              colorTextSecondary: "#9ca3af",
              borderRadius: "0.75rem",
              fontFamily: "var(--font-sora), sans-serif",
            },
            elements: {
              card: "shadow-2xl shadow-blue-500/5 border border-white/[0.06] bg-[#0a1224]",
              headerTitle: "font-display font-bold",
              headerSubtitle: "text-zinc-400",
              socialButtonsBlockButton:
                "border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 transition-all",
              formFieldInput:
                "border-white/[0.08] bg-white/[0.04] text-zinc-200 focus:border-blue-500 focus:ring-blue-500/30",
              formButtonPrimary:
                "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-500/20 font-semibold transition-all",
              footerActionLink: "text-blue-400 hover:text-blue-300",
              dividerLine: "bg-white/[0.06]",
              dividerText: "text-zinc-500",
              formFieldLabel: "text-zinc-300",
              identityPreviewEditButton: "text-blue-400 hover:text-blue-300",
              otpCodeFieldInput:
                "border-white/[0.08] bg-white/[0.04] text-zinc-200",
            },
          }}
        />
      </div>
    </div>
  );
}
