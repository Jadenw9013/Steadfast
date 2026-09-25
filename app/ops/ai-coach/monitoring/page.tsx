import { notFound } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getAiCoachOperationalMonitoring } from "@/lib/ai-coach/operations";
import { AiCoachError } from "@/lib/ai-coach/access";

export const dynamic = "force-dynamic";

export default async function AiCoachMonitoringPage() {
  const user = await getCurrentDbUser();
  let monitoring;
  try {
    monitoring = await getAiCoachOperationalMonitoring(user.id);
  } catch (error) {
    if (error instanceof AiCoachError) notFound();
    throw error;
  }
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 text-zinc-100">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-400">
          AI Coach operations
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Aggregate safety monitoring</h1>
        <p className="mt-2 text-zinc-400">
          No prompts, traces, intake answers, client identifiers, or provider prose are shown.
        </p>
      </header>
      <section aria-labelledby="launch-status" className="sf-glass-card rounded-2xl p-5">
        <h2 id="launch-status" className="text-lg font-semibold">
          Launch authority
        </h2>
        <p className="mt-2 text-zinc-300">{monitoring.liveRelease.status}</p>
      </section>
      <section aria-labelledby="alert-status" className="sf-glass-card rounded-2xl p-5">
        <h2 id="alert-status" className="text-lg font-semibold">
          Approved alert policy
        </h2>
        <p className="mt-2 text-zinc-300">{monitoring.alerts.status}</p>
        {monitoring.alerts.breachCodes.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-6 text-amber-300">
            {monitoring.alerts.breachCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        )}
      </section>
      <section
        aria-labelledby="provider-metrics"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <h2 id="provider-metrics" className="sr-only">
          Provider measurements
        </h2>
        {[
          ["Measured calls", monitoring.providerMeasurements.measuredCalls],
          ["P95 latency (ms)", monitoring.providerMeasurements.p95LatencyMs],
          ["Failure rate (basis points)", monitoring.providerMeasurements.failureRateBasisPoints],
          ["Total tokens", monitoring.providerMeasurements.totalTokens],
        ].map(([label, value]) => (
          <div key={label} className="sf-glass-card rounded-2xl p-5">
            <p className="text-sm text-zinc-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
