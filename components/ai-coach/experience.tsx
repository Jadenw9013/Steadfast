"use client";
import Link from "next/link";
import { AiCheckInForm, AiSessionForm } from "./evidence-forms";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiWorkspace } from "@/lib/queries/ai-coach";
import { PlanDisplay } from "./plan-display";
import { IntakeWizard } from "./intake-wizard";
import { button, primary, fieldClass } from "./controls";

export function AiCoachExperience({
  initial,
  path = [],
}: {
  initial: AiWorkspace;
  path?: string[];
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"MACROS" | "MEALS">(
    (initial.confirmedIntake as { trackingPreference?: string } | null)?.trackingPreference ===
      "PORTIONS_ONLY" || initial.activePlan?.payload.meals
      ? "MEALS"
      : "MACROS"
  );
  const [consent, setConsent] = useState(false);
  const [pauseConfirmed, setPauseConfirmed] = useState(false);
  const keys = useRef(new Map<string, string>());
  const refresh = useCallback(async () => {
    const res = await fetch("/api/client/ai-coach/workspace", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? "Could not refresh your coaching state.");
    setView(body.data as AiWorkspace);
  }, []);
  useEffect(() => {
    if (!view.runs.some((run) => ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(run.status))) return;
    const timer = setInterval(() => {
      if (!document.hidden)
        refresh().catch(() =>
          setError(
            "Connection interrupted. Your saved run will continue; refresh to check its status."
          )
        );
    }, 3000);
    return () => clearInterval(timer);
  }, [view.runs, refresh]);
  async function post(url: string, input: Record<string, unknown>) {
    const fingerprint = JSON.stringify({ url, input });
    const requestKey = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, requestKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, requestKey }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message ?? "This change was not confirmed. Please try again.");
    keys.current.delete(fingerprint);
    return result.data;
  }
  async function act(work: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Connection interrupted. Your inputs are still here."
      );
    } finally {
      setBusy(false);
    }
  }
  const command = (input: Record<string, unknown>) =>
    post("/api/client/ai-coach/commands", {
      expectedProfileRevision: view.profileRevision,
      ...input,
    });
  const screen = path[0] ?? "home";
  const liveDisclosure = view.experience.mode === "LIVE" ? view.experience.disclosure : null;
  if (view.experience.mode === "LIVE" && !liveDisclosure) {
    return (
      <section
        role="alert"
        className="mx-auto max-w-xl space-y-4 rounded-2xl border border-amber-500/30 p-6"
      >
        <h1 className="text-2xl font-semibold text-zinc-100">AI coaching is unavailable</h1>
        <p className="text-zinc-300">
          The approved disclosure configuration is unavailable. No enrollment or coaching action can
          continue.
        </p>
        <Link className={`${button} inline-flex items-center`} href="/client">
          Return home
        </Link>
      </section>
    );
  }
  const proposal = view.proposals.find((p) => p.id === path[1]);
  const review = view.runs.find((r) => r.id === path[1]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-400">
          {liveDisclosure ? liveDisclosure.serviceLabel : "Steadfast AI Coach · Synthetic preview"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-100">
          {{
            home: "Your coaching plan",
            plan: "Your current plan",
            start: "A clear next step",
            intake: "Build your starting point",
            progress: "Plan preparation",
            proposals: "Review your proposal",
            reviews: "Your weekly reviews",
            settings: "Coaching settings",
            "check-in": "Your weekly check-in",
            sessions: "Record your activity",
          }[screen] ?? "Your coaching plan"}
        </h1>
        <p className="mt-3 text-zinc-400">
          {liveDisclosure
            ? liveDisclosure.summary
            : "This test experience uses synthetic policies and content. It is not a real health or exercise recommendation, and it is not monitored continuously."}
        </p>
      </header>
      <nav aria-label="AI coaching" className="flex flex-wrap gap-2">
        {[
          ["intake", "Intake"],
          ["progress", "Preparation"],
          ["sessions", "Record activity"],
          ["settings", "Settings"],
        ].map(([href, label]) => (
          <Link key={href} className={button} href={`/client/ai-coach/${href}`}>
            {label}
          </Link>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border border-emerald-500/30 p-4 text-emerald-300">
          {message}
        </p>
      )}
      {view.safetyDisposition !== "CLEAR" && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="font-semibold text-amber-200">A concern needs attention</h2>
          <p className="mt-2 text-zinc-300">
            {liveDisclosure
              ? "Current recommendations are unavailable. Follow the reviewed next step shown for this status."
              : `Current status: ${view.safetyDisposition.toLowerCase()}. Affected recommendations remain restricted until an authorized reviewer resolves the concern. This preview cannot provide emergency support.`}
          </p>
        </section>
      )}
      {(screen === "start" || screen === "home") && (
        <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl font-semibold text-zinc-100">
            {view.confirmedIntake ? "Your next step" : "Begin with your preferences"}
          </h2>
          {!view.confirmedIntake ? (
            <Link className={`${primary} inline-flex items-center`} href="/client/ai-coach/intake">
              Complete your intake
            </Link>
          ) : view.origin !== "AI" ? (
            <>
              {liveDisclosure && (
                <div className="space-y-3 rounded-xl border border-white/10 p-4 text-zinc-300">
                  <h3 className="font-semibold text-zinc-100">
                    {liveDisclosure.informationHeading}
                  </h3>
                  {liveDisclosure.disclosureParagraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  <a
                    className="underline underline-offset-4"
                    href={liveDisclosure.privacyNoticeUrl}
                  >
                    {liveDisclosure.privacyNoticeLabel}
                  </a>
                </div>
              )}
              <label className="flex min-h-12 items-start gap-3 text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                {liveDisclosure
                  ? liveDisclosure.consentLabel
                  : "I consent to this synthetic AI coaching preview and understand it changes my current coaching provider."}
              </label>
              <button
                className={primary}
                disabled={busy || !consent}
                onClick={() =>
                  act(
                    () =>
                      command({
                        operation: "ENROLL",
                        consent: true,
                        expectedContextRevision: view.contextRevision,
                        reviewTimezone:
                          view.reviewTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
                        ...(liveDisclosure
                          ? {
                              consentConfigurationId: liveDisclosure.configurationId,
                              consentConfigurationVersion: liveDisclosure.configurationVersion,
                              privacyNoticeVersion: liveDisclosure.privacyNoticeVersion,
                              consentTextDigest: liveDisclosure.consentTextDigest,
                            }
                          : {}),
                      }),
                    "Enrollment confirmed."
                  )
                }
              >
                {liveDisclosure?.confirmLabel ?? "Confirm enrollment"}
              </button>
            </>
          ) : (
            <>
              <label className="block text-zinc-300">
                Nutrition presentation
                <select
                  className={fieldClass}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "MACROS" | "MEALS")}
                >
                  <option value="MACROS">Macro targets</option>
                  <option value="MEALS">Meal portions</option>
                </select>
              </label>
              <button
                className={primary}
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      post("/api/client/ai-coach/runs", {
                        kind: view.activePlan ? "WEEKLY_REVIEW" : "INITIAL",
                        representation: mode,
                        expectedContextRevision: view.contextRevision,
                        expectedProfileRevision: view.profileRevision,
                      }),
                    "Preparation request saved. You may leave and return."
                  )
                }
              >
                {view.activePlan ? "Request this week’s review" : "Prepare initial proposal"}
              </button>
              {view.activePlan && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    act(
                      () =>
                        post("/api/client/ai-coach/runs", {
                          kind: "REPRESENTATION",
                          representation: mode,
                          expectedContextRevision: view.contextRevision,
                          expectedProfileRevision: view.profileRevision,
                        }),
                      "Presentation request saved. Review the proposal when preparation finishes."
                    )
                  }
                >
                  Preview presentation change
                </button>
              )}
            </>
          )}
        </section>
      )}
      {screen === "check-in" && <AiCheckInForm onRefresh={refresh} />}
      {screen === "sessions" && <AiSessionForm view={view} onRefresh={refresh} />}
      {screen === "intake" && (
        <IntakeWizard view={view} busy={busy} act={act} command={command} post={post} />
      )}
      {screen === "plan" && !view.activePlan && (
        <p className="text-zinc-400">
          No current accepted plan is available. Return home to finish intake or check preparation.
        </p>
      )}
      {(screen === "home" || screen === "progress") && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Preparation and proposals</h2>
          {view.runs.length === 0 && (
            <p className="text-zinc-400">No preparation request has been saved yet.</p>
          )}
          {view.runs.slice(0, 3).map((run) => (
            <div key={run.id} className="rounded-xl border border-white/10 p-4">
              <p className="text-zinc-100">
                {run.kind.replaceAll("_", " ")} · {run.status.replaceAll("_", " ")}
              </p>
              {run.failureMessage && <p className="mt-2 text-zinc-400">{run.failureMessage}</p>}
              {run.status === "FAILED" && (
                <button
                  className={`${button} mt-3`}
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => post(`/api/client/ai-coach/runs/${run.id}/retry`, {}),
                      "Retry saved with the original evidence and review window."
                    )
                  }
                >
                  Retry preparation
                </button>
              )}
            </div>
          ))}
          {view.proposals.map((p) => (
            <Link
              key={p.id}
              className={`${button} flex items-center justify-between`}
              href={`/client/ai-coach/proposals/${p.id}`}
            >
              <span>Plan proposal</span>
              <span>
                {p.status === "READY"
                  ? "Ready to review"
                  : p.status === "STALE"
                    ? "Needs a fresh review"
                    : p.status === "PENDING_FINALIZATION"
                      ? "Ready for safety checks"
                      : p.status.replaceAll("_", " ").toLowerCase()}
              </span>
            </Link>
          ))}
        </section>
      )}
      {screen === "proposals" &&
        (proposal ? (
          <section className="space-y-4">
            {proposal.payload ? (
              <>
                <p className="text-zinc-300">
                  This is a proposed plan. Your current plan stays active until you accept.
                </p>
                {(() => {
                  // T-2006 — validated model prose when present, otherwise
                  // the run's deterministic decision sentence (the template
                  // fallback iOS already renders on this screen,
                  // AICoachViews.swift:158; web previously did not). Never
                  // render an empty paragraph.
                  const explanationText =
                    proposal.authorization?.explanation?.text ??
                    view.runs.find((run) => run.resultPlanVersionId === proposal.id)?.decision
                      ?.explanation ??
                    null;
                  if (!explanationText) return null;
                  return (
                    <div className="rounded-xl border border-white/10 p-4">
                      <p className="text-sm text-zinc-400">Automated explanation</p>
                      <p className="mt-1 text-zinc-100">{explanationText}</p>
                    </div>
                  );
                })()}
                {view.activePlan && (
                  <details className="rounded-xl border border-white/10 p-4">
                    <summary className="min-h-12 cursor-pointer">
                      Compare your current accepted plan
                    </summary>
                    <PlanDisplay
                      plan={view.activePlan.payload}
                      portionsOnly={
                        (view.confirmedIntake as { trackingPreference?: string } | null)
                          ?.trackingPreference === "PORTIONS_ONLY"
                      }
                    />
                  </details>
                )}
                <PlanDisplay
                  portionsOnly={
                    (view.confirmedIntake as { trackingPreference?: string } | null)
                      ?.trackingPreference === "PORTIONS_ONLY"
                  }
                  plan={proposal.payload}
                />
                <div className="flex gap-3">
                  <button
                    className={primary}
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          post(`/api/client/ai-coach/plans/${proposal.id}/accept`, {
                            expectedBaseVersionId: proposal.expectedBaseVersionId,
                            expectedContextRevision: proposal.expectedContextRevision,
                            expectedProfileRevision: proposal.expectedProfileRevision,
                            expectedObservationRevision: proposal.expectedObservationRevision,
                            expectedSafetyRevision: proposal.expectedSafetyRevision,
                          }),
                        "Plan accepted. Your current plan has been updated."
                      )
                    }
                  >
                    Accept proposal
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => post(`/api/client/ai-coach/plans/${proposal.id}/decline`, {}),
                        "Proposal declined. Your current plan stays unchanged."
                      )
                    }
                  >
                    Decline
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-4 rounded-xl border border-white/10 p-5 text-zinc-300">
                <p>
                  {proposal.status === "STALE"
                    ? "Your coaching state changed. Request a fresh proposal from Overview."
                    : proposal.status === "PENDING_FINALIZATION"
                      ? "Run the server-owned safety, evidence, catalog and constrained-provider checks before any instructions are shown."
                      : proposal.status === "FOCUSED_CLARIFICATION"
                        ? (proposal.authorization?.clarification?.text ??
                          "A specific answer is still required. Your current plan remains unchanged.")
                        : proposal.status === "PAUSE_REFER"
                          ? "This proposal is paused. Follow the reviewed next step before requesting another proposal."
                          : "The deterministic policy has placed this proposal on hold. Your current plan remains unchanged."}
                </p>
                {proposal.status === "PENDING_FINALIZATION" && (
                  <button
                    className={primary}
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => post(`/api/client/ai-coach/plans/${proposal.id}/finalize`, {}),
                        "Safety and policy checks completed."
                      )
                    }
                  >
                    Run final safety checks
                  </button>
                )}
              </div>
            )}
          </section>
        ) : (
          <p className="text-zinc-400">
            This proposal is no longer pending. Return to Overview for your current plan.
          </p>
        ))}
      {screen === "reviews" && (
        <section className="space-y-4">
          {path[1] ? (
            review ? (
              <>
                <p className="text-zinc-100">{review.decision?.action ?? review.status}</p>
                <p className="text-zinc-300">{review.decision?.explanation}</p>
                {review.decision?.limitations.map((text) => (
                  <p key={text} className="text-sm text-zinc-400">
                    {text}
                  </p>
                ))}
                <p className="text-zinc-100">{review.decision?.nextAction}</p>
              </>
            ) : (
              <p className="text-zinc-400">Review not found.</p>
            )
          ) : view.runs.length ? (
            view.runs.map((run) => (
              <Link
                className={`${button} block`}
                key={run.id}
                href={`/client/ai-coach/reviews/${run.id}`}
              >
                {new Date(run.createdAt).toLocaleDateString("en-US", {
                  timeZone: view.reviewTimezone ?? "UTC",
                })}{" "}
                · {run.decision?.action ?? run.status}
              </Link>
            ))
          ) : (
            <p className="text-zinc-400">Your reviews will appear here after a saved run.</p>
          )}
        </section>
      )}
      {screen === "settings" && (
        <section className="space-y-4 rounded-2xl border border-white/10 p-5">
          <p className="text-zinc-300">
            Review timezone: {view.reviewTimezone ?? "Set at enrollment"}. Travel does not reset
            review windows.
          </p>
          <label className="flex min-h-12 items-center gap-3 text-zinc-300">
            <input
              type="checkbox"
              checked={pauseConfirmed}
              onChange={(e) => setPauseConfirmed(e.target.checked)}
            />
            I want to pause AI coaching and its current recommendations.
          </label>
          <button
            className={button}
            disabled={busy || !pauseConfirmed || view.origin !== "AI"}
            onClick={() =>
              act(
                () =>
                  command({
                    operation: "PAUSE",
                    confirmed: true,
                    expectedContextRevision: view.contextRevision,
                  }),
                "AI coaching paused. Your history has been retained."
              )
            }
          >
            Confirm pause
          </button>
          <a href="/api/client/ai-coach/export" className={`${button} block`}>
            Download my AI coaching data
          </a>
          <p className="text-sm text-zinc-400">
            The download includes your retained intake, observations, plans and review history. Keep
            it somewhere private.
          </p>
          <Link href="/client/profile" className={`${button} block`}>
            Account and privacy settings
          </Link>
        </section>
      )}
      {(screen === "home" || screen === "plan") && view.activePlan && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-100">Current accepted plan</h2>
          <p className="text-sm text-zinc-400">
            Accepted{" "}
            {new Date(view.activePlan.acceptedAt).toLocaleDateString("en-US", {
              timeZone: view.reviewTimezone ?? "UTC",
            })}{" "}
            · Nutrition {view.permissions.nutrition}, strength {view.permissions.strength}, cardio{" "}
            {view.permissions.cardio}
          </p>
          <PlanDisplay
            portionsOnly={
              (view.confirmedIntake as { trackingPreference?: string } | null)
                ?.trackingPreference === "PORTIONS_ONLY"
            }
            plan={view.activePlan.payload}
            substitutions={view.substitutions}
            busy={busy}
            onSubstitute={(substitution) =>
              act(
                () =>
                  post("/api/client/ai-coach/runs", {
                    kind: "REPRESENTATION",
                    representation: "MEALS",
                    substitution,
                    expectedContextRevision: view.contextRevision,
                    expectedProfileRevision: view.profileRevision,
                  }),
                "Substitution request saved. Your current meals stay unchanged until acceptance."
              )
            }
          />
        </section>
      )}
    </div>
  );
}
