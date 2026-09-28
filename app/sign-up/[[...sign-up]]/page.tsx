import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Image from "next/image";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] bg-zinc-50">
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

          <h1 className="font-display text-3xl font-bold tracking-tight text-gray-900">
            Start your journey.
          </h1>
          <p className="mt-3 text-base leading-relaxed text-gray-500">
            Join Steadfast and connect with a coach who keeps you accountable, week after week.
          </p>

          {/* Floating feature pills */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {["Weekly check-ins", "Meal plans", "Progress tracking", "Coach inbox"].map((f) => (
              <span
                key={f}
                className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-500"
              >
                {f}
              </span>
            ))}
          </div>

          {/* Scripture accent */}
          <div className="mt-16 border-t border-gray-200 pt-8">
            <blockquote className="text-sm italic leading-relaxed text-gray-400">
              &ldquo;I can do all things through Christ who strengthens me&rdquo;
            </blockquote>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500">
              Philippians 4:13
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — sign-up form */}
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
          <span className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gray-400">
            Steadfast
          </span>
        </Link>

        <SignUp
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
              card: "shadow-2xl shadow-blue-500/5 border border-white/[0.06] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl",
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

        {/* Registration awareness & liability disclaimer */}
        <div className="mt-6 w-full max-w-[400px] rounded-xl border border-zinc-200 bg-white/95 p-4 text-xs leading-relaxed text-zinc-600 shadow-sm">
          <p className="font-semibold text-zinc-900 mb-1">Medical Disclaimer &amp; Liability Notice</p>
          <p className="mb-1.5">
            <strong>Not Medical Advice:</strong> Steadfast provides general fitness and wellness coaching only and does not provide medical advice, clinical nutrition therapy, diagnosis, or treatment. Coaches and content reviewers are not required to hold medical or clinical credentials.
          </p>
          <p className="mb-1.5">
            <strong>Consult Your Doctor:</strong> You agree that you should consult your doctor or a qualified healthcare professional before beginning any diet, training, or exercise program. You assume full risk for your participation.
          </p>
          <p className="text-[11px] text-zinc-500">
            By creating an account, you agree to our{" "}
            <Link href="/terms" className="text-blue-600 underline hover:text-blue-500" target="_blank">
              Terms of Service
            </Link>{" "}
            and acknowledge that Steadfast is not liable for health outcomes or injuries.
          </p>
        </div>
      </div>
    </div>
  );
}
