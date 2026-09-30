"use client";
import Link from "next/link";
import { AiCheckInForm, AiSessionForm } from "./evidence-forms";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiWorkspace } from "@/lib/queries/ai-coach";
import { PlanDisplay } from "./plan-display";
import { IntakeWizard } from "./intake-wizard";
import { button, primary, fieldClass } from "./controls";

/** S-19: display names for the three governed domains in `safetyRestriction`. */
const DOMAIN_LABELS: Record<"NUTRITION" | "STRENGTH" | "CARDIO", string> = {
  NUTRITION: "Nutrition",
  STRENGTH: "Strength training",
  CARDIO: "Cardio",
};

/** S-26: past this many elapsed seconds the card stops implying active
 * progress (the typical run completes in 5–15s) and tells the person they
 * can leave instead of watching a screen that looks the same whether it is
 * about to finish or already stuck. */
const RUN_PROGRESS_ELAPSED_CEILING_SECONDS = 120;

/**
 * S-26 — maps a run's server-owned `lastError` (an `AiCoachError.code`, or
 * one of `runs.ts`'s two fixed reconciliation strings — see
 * `lib/queries/ai-coach.ts`'s projection comment) to safe, non-leaky client
 * copy. The raw code is never rendered; an unrecognized value (a future
 * code, or one of the reconciliation strings) falls through to a generic
 * sentence rather than a blank.
 */
function describeRunFailureReason(lastError: string | null | undefined): string {
  switch (lastError) {
    case "RUNTIME_ARTIFACTS_UNPUBLISHED":
      return "This environment isn't fully set up for AI coaching yet.";
    case "RATE_LIMITED":
      return "Too many preparation requests were made in a short time.";
    case "VALIDATION_ERROR":
      return "The generated plan did not pass an automated safety check.";
    case "LIVE_COMPOSITION_UNAVAILABLE":
      return "Live plan preparation is not available yet.";
    case "REVISION_CONFLICT":
      return "Your coaching details changed while this was being prepared.";
    case "TEMPORARILY_UNAVAILABLE":
      return "Plan preparation is temporarily paused.";
    default:
      return "The last attempt could not finish.";
  }
}

function AiRunProgressTracker({
  run,
  maxAttemptsPerRun,
}: {
  run: {
    id: string;
    kind: string;
    status: string;
    attempts?: number;
    lastError?: string | null;
  };
  maxAttemptsPerRun: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [run.id]);

  // S-26: RETRY_WAIT means an attempt already failed — it must never look
  // like a healthy in-progress run. This branch is visually and textually
  // distinct from QUEUED/RUNNING below: amber not blue, no spinner claiming
  // active work, the attempt count against the maximum, and the failure
  // reason mapped from the server-owned `lastError` code.
  if (run.status === "RETRY_WAIT") {
    return (
      <section
        role="status"
        className="sf-glass-card rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 space-y-3 shadow-lg shadow-amber-500/5"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-3 w-3 rounded-full bg-amber-400" />
          <h2 className="font-semibold text-zinc-100">An attempt did not finish</h2>
        </div>
        <p className="text-zinc-300">
          {describeRunFailureReason(run.lastError)} Steadfast will retry automatically — attempt{" "}
          {Math.min(run.attempts ?? 1, maxAttemptsPerRun)} of {maxAttemptsPerRun}.
        </p>
        <p className="text-xs text-zinc-400">
          You do not need to do anything right now. If every attempt is used without success, this
          becomes a failed preparation with a retry option.
        </p>
      </section>
    );
  }

  const pastCeiling = elapsed >= RUN_PROGRESS_ELAPSED_CEILING_SECONDS;

  return (
    <section className="sf-glass-card rounded-2xl border border-blue-500/30 bg-blue-950/20 p-5 space-y-3 shadow-lg shadow-blue-500/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
          </span>
          <h2 className="font-semibold text-zinc-100">
            {run.kind === "INITIAL" ? "Preparing Your Coaching Plan" : "Generating Weekly Review"}
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-300 border border-blue-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          {run.status === "QUEUED" ? "Waiting to start" : "In progress"} ({elapsed}s)
        </span>
      </div>

      {pastCeiling ? (
        // S-26: the elapsed-time ceiling. No more claim of specific,
        // ongoing work — the honest statement is "this is unusual", plus a
        // next step that does not require staring at the screen.
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm text-amber-100">
            This is taking longer than the usual 5–15 seconds. It may still finish, but you do not
            need to keep watching this screen.
          </p>
          <p className="text-xs text-zinc-400">
            Leave and come back later — your request is saved, and this page will show the result
            when you return.
          </p>
        </div>
      ) : (
        // S-26: an honest indeterminate indicator — no percentage, no named
        // stages the backend cannot substantiate (`processManagedRun` is a
        // single opaque pass; there is no four-step pipeline to report on).
        <>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900 border border-white/10">
            <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-400" />
          </div>
          <p className="text-xs text-zinc-400">
            The engine runs in the background. Typical preparation completes in 5–15 seconds.
          </p>
        </>
      )}
    </section>
  );
}

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
  const activeRun = view.runs.find((run) => ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(run.status));
  const restriction = view.safetyRestriction;
  // Intake is confirmed but the client has not yet made the enrolment consent
  // decision (S-19 dead end 2). Unchanged condition, named so the heading and
  // the body agree about which state is on screen.
  const awaitingConsent = Boolean(view.confirmedIntake) && (view.origin !== "AI" || !view.consentedAt);
  const readyProposal = view.proposals.find((p) => p.status === "READY");
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
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 space-y-2"
        >
          <p>{error}</p>
          {(error.includes("intake") || error.includes("consent")) && (
            <div className="pt-1">
              <Link
                href="/client/ai-coach/intake"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-200 underline underline-offset-2 hover:text-white"
              >
                Go to intake questionnaire →
              </Link>
            </div>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="rounded-xl border border-emerald-500/30 p-4 text-emerald-300">
          {message}
        </p>
      )}
      {restriction && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="font-semibold text-amber-200">A concern needs attention</h2>
          <p className="mt-2 text-zinc-300">
            {liveDisclosure
              ? "Current recommendations are unavailable. Follow the reviewed next step shown for this status."
              : `Current status: ${restriction.disposition.toLowerCase()}. Affected recommendations remain restricted until an authorized reviewer resolves the concern. This preview cannot provide emergency support.`}
          </p>
          {/* S-19 dead end 1: before this, nothing client-facing named the
              restricted domains, said the client cannot clear it, or said who
              can. The first sign of it was a SAFETY_RESTRICTED 409 on the next
              plan request. */}
          {restriction.restrictedDomains.length > 0 && (
            <p className="mt-3 text-zinc-300">
              Restricted right now:{" "}
              <span className="font-medium text-amber-100">
                {restriction.restrictedDomains.map((d) => DOMAIN_LABELS[d]).join(", ")}
              </span>
              .
            </p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            This is recorded whenever new safety information arrives — including a change to your
            allergy answers after your intake was confirmed. It is not something you can clear
            yourself, and re-running your intake will not remove it. Only an authorized Steadfast
            reviewer can lift it, for each affected area.
          </p>
          {restriction.planRequestBlocked && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              While it is in place, a new plan cannot be prepared.
            </p>
          )}
        </section>
      )}
      {(screen === "start" || screen === "home") && (
        <>
          {activeRun && (
            <AiRunProgressTracker run={activeRun} maxAttemptsPerRun={view.maxAttemptsPerRun} />
          )}
          {readyProposal && !view.activePlan && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 shadow-lg shadow-emerald-500/5">
              <div>
                <h3 className="font-semibold text-emerald-200 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold">
                    ✓
                  </span>
                  Your Coaching Plan Proposal is Ready!
                </h3>
                <p className="mt-1 text-sm text-zinc-300">
                  Your personalized training schedule and measured meal portions are ready to review.
                </p>
              </div>
              <Link href={`/client/ai-coach/proposals/${readyProposal.id}`} className={primary}>
                Review proposal →
              </Link>
            </div>
          )}
          <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
            <h2 className="text-xl font-semibold text-zinc-100">
              {!view.confirmedIntake
                ? "Begin with your preferences"
                : awaitingConsent
                  ? "One step left: review and consent"
                  : "Your next step"}
            </h2>
            {!view.confirmedIntake ? (
              <Link className={`${primary} inline-flex items-center`} href="/client/ai-coach/intake">
                Complete your intake
              </Link>
            ) : awaitingConsent ? (
              <>
                {/* S-19 dead end 2: the intake wizard's final button confirms
                    answers and lands here. Say that plainly, so the arrival is
                    a stated next step rather than "nothing happened". */}
                <p className="text-zinc-300">
                  Your answers are saved. Review the information below and consent — your plan is
                  prepared after that.
                </p>
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
                  <span className="mt-1.5 block text-xs text-zinc-400">
                    {mode === "MEALS"
                      ? "Both options give exact measurements (e.g. 100g rice, 150g chicken). Meal portions lets you plate without daily macro math."
                      : "Both options give exact measurements. Macro targets also displays daily calorie, protein, carb, and fat totals."}
                  </span>
                </label>
                {activeRun ? (
                  // S-26: RETRY_WAIT is not "in progress" — an attempt already
                  // failed. Distinct color, no spinner, distinct copy.
                  activeRun.status === "RETRY_WAIT" ? (
                    <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                      <span className="inline-block h-4 w-4 shrink-0 rounded-full bg-amber-400" />
                      <span>
                        An attempt did not finish and will retry automatically. See the tracker
                        above for details.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent shrink-0" />
                      <span>Plan preparation in progress. Follow the live tracker above — your proposal will be ready shortly.</span>
                    </div>
                  )
                ) : restriction?.planRequestBlocked ? (
                  // S-19 dead end 1: the server would refuse this request with
                  // SAFETY_RESTRICTED (409). Say so here instead of offering a
                  // button whose only outcome is that error.
                  <p
                    role="note"
                    className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100"
                  >
                    A new plan cannot be prepared while the safety concern above is open. An
                    authorized Steadfast reviewer has to lift it first.
                  </p>
                ) : (
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
                )}
                {view.activePlan && !activeRun && !restriction?.planRequestBlocked && (
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
        </>
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
