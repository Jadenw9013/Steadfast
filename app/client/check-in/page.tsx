import Link from "next/link";
import { getClientProvider, rendersAiWorkspace } from "@/lib/queries/client-provider";
import { AiClientSurface, ProviderResolution } from "@/components/ai-coach/client-surface";
import { CheckInForm } from "@/components/check-in/check-in-form";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getLatestCheckIn } from "@/lib/queries/check-ins";
import { getActiveTemplateForClient } from "@/lib/queries/check-in-templates";

type TemplateQuestion = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
};

export default async function ClientCheckInPage() {
  const user = await getCurrentDbUser();
  const provider = await getClientProvider(user.id);
  if (provider.resolutionRequired) return <ProviderResolution />;
  if (rendersAiWorkspace(provider)) return <AiClientSurface clientId={user.id} path={["check-in"]} />;

  // S-34 review finding 3: an offer-state (or otherwise coachless) client
  // reaches a signposted dead end without this branch — `CheckInForm`
  // renders and accepts input, but every submission is rejected by
  // `lib/check-ins/submit.ts` ("You need to connect to a coach before
  // submitting check-ins."). Mirrors the NONE branch already shipped on
  // `/client/training`, `/client/meal-plan` and `/client/plan`.
  if (provider.origin === "NONE") {
    return (
      <div className="space-y-8">
        <section className="animate-fade-in">
          <Link href="/client" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500" aria-label="Back to dashboard">
            &larr; Dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-white">Check-In</h1>
        </section>
        <div className="sf-surface-card flex flex-col items-center gap-5 px-5 py-14 text-center sm:px-8 sm:py-20" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/60">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-zinc-100">Check-In requires a coach</p>
            <p className="text-sm text-zinc-400">Once you connect with a coach, this will unlock automatically.</p>
          </div>
          <Link href="/coaches" className="sf-button-primary block" style={{ minHeight: "48px" }}>
            Find a Coach
          </Link>
        </div>
      </div>
    );
  }

  const [latest, template] = await Promise.all([
    getLatestCheckIn(user.id),
    getActiveTemplateForClient(user.id),
  ]);

  const templateQuestions = template
    ? (template.questions as TemplateQuestion[])
    : undefined;

  return (
    <div className="mx-auto max-w-lg">
      {/* Page header */}
      <div className="mb-4 sm:mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Weekly Update</p>
        <h1 className="mt-0.5 text-xl sm:text-2xl font-black tracking-tight text-white">Check-In</h1>
      </div>

      <CheckInForm
        previousWeight={
          latest?.weight
            ? {
              weight: latest.weight,
              date: latest.submittedAt.toISOString(),
            }
            : null
        }
        templateId={template?.id}
        templateQuestions={templateQuestions}
      />
    </div>
  );
}
