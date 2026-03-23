import { getCurrentDbUser } from "@/lib/auth/roles";
import { getClientCheckInsLight, getLatestCoachMessage } from "@/lib/queries/check-ins";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { formatDateUTC, getLocalDate } from "@/lib/utils/date";
import { getMyIntake } from "@/lib/queries/client-intake";
import { parseCadenceConfig, getEffectiveCadence, getClientCadenceStatus, cadenceFromLegacyDays, getCadencePreview } from "@/lib/scheduling/cadence";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { getAdherenceEnabled, getTodayAdherence, getTodayMealNames } from "@/lib/queries/adherence";
import { parsePlanExtras } from "@/types/meal-plan-extras";
import { db } from "@/lib/db";
import Link from "next/link";
import Image from "next/image";
import { ConnectCoachBanner } from "@/components/client/connect-coach-banner";
import { MyRequestsCard } from "@/components/client/my-requests-card";
import { getMyCoachingRequests } from "@/lib/queries/my-requests";
import { TestimonialPrompt } from "@/components/client/testimonial-prompt";
import { getTestimonialEligibility } from "@/lib/queries/testimonial-eligibility";
import { BecomeCoachForm } from "@/components/client/become-coach-form";
import { CheckInStatus } from "@/components/client/check-in-status";
import { CheckInScheduleBanner } from "@/components/client/check-in-schedule-banner";
import { TodayAdherence } from "@/components/client/today-adherence";
import { CoachRulesCard } from "@/components/client/coach-rules-card";
import { DeleteCheckInButton } from "@/components/client/delete-check-in-button";
import { WeightProgress } from "@/components/charts/weight-progress";
import { getWeightHistory } from "@/lib/queries/weight-history";
import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
import timezonePlugin from "dayjs/plugin/timezone";
import { ClientTeamBanner } from "@/components/client/ClientTeamBanner";

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

export default async function ClientDashboard() {
  const user = await getCurrentDbUser();

  const coachAssignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: {
      id: true,
      cadenceConfig: true,
      coach: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          checkInDaysOfWeek: true,
          cadenceConfig: true,
          coachProfile: { select: { welcomeMessage: true, slug: true, isPublished: true, bannerPhotoPath: true } },
          profilePhotoPath: true,
        },
      },
    },
  });

  const tz = user.timezone || "America/Los_Angeles";
  const todayDate = getLocalDate(new Date(), tz);

  const [checkIns, mealPlan, latestCoachMessage, weightHistory, trainingProgram, pendingIntake, adherenceEnabled, todayAdherence, planMeals] = await Promise.all([
    getClientCheckInsLight(user.id),
    getCurrentPublishedMealPlan(user.id),
    getLatestCoachMessage(user.id),
    getWeightHistory(user.id),
    getPublishedTrainingProgram(user.id),
    getMyIntake(user.id),
    getAdherenceEnabled(user.id),
    getTodayAdherence(user.id, todayDate),
    getTodayMealNames(user.id),
  ]);

  // ── Cadence-aware status derivation ──────────────────────────────────────

  const coachCadence = coachAssignment
    ? parseCadenceConfig(coachAssignment.coach.cadenceConfig)
    : null;
  const clientCadenceOverride = coachAssignment
    ? parseCadenceConfig(coachAssignment.cadenceConfig)
    : null;
  const effectiveCadence = coachAssignment
    ? getEffectiveCadence(
      coachCadence ?? cadenceFromLegacyDays(coachAssignment.coach.checkInDaysOfWeek),
      clientCadenceOverride
    )
    : null;

  const latestCheckIn = checkIns[0] ?? null;
  const cadenceResult = effectiveCadence
    ? getClientCadenceStatus(
      effectiveCadence,
      latestCheckIn ? { submittedAt: latestCheckIn.submittedAt, status: latestCheckIn.status } : null,
      tz
    )
    : null;

  const weekStatus: "none" | "submitted" | "reviewed" = !latestCheckIn
    ? "none"
    : latestCheckIn.status === "REVIEWED"
      ? "reviewed"
      : "submitted";

  const todayLabel = dayjs(new Date()).tz(tz).format("MMM D, YYYY");
  const cadencePreview = effectiveCadence ? getCadencePreview(effectiveCadence) : null;
  const statusLabel = cadenceResult?.label;
  const nextDueLabel = cadencePreview ?? undefined;

  // ── Coach rules from latest published plan ────────────────────────────────
  const planExtras = parsePlanExtras(mealPlan?.planExtras);
  const coachRules = planExtras?.rules ?? [];

  const latestWeight = checkIns.find((c) => c.weight != null);
  const prevWeight = latestWeight
    ? checkIns.find((c) => c.weight != null && c.id !== latestWeight.id)
    : null;
  const weightDelta =
    latestWeight?.weight && prevWeight?.weight
      ? +(latestWeight.weight - prevWeight.weight).toFixed(1)
      : null;

  let coachAvatarUrl: string | null = null;
  if (coachAssignment) {
    const avatarPath = coachAssignment.coach.profilePhotoPath;
    if (avatarPath) {
      try { coachAvatarUrl = await getProfilePhotoUrl(avatarPath); } catch { /* */ }
    }
  }
  const coachInitial = coachAssignment?.coach.firstName?.[0] ?? "C";

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <section className="animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              {user.firstName ? `Hey ${user.firstName}` : "Your Week"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {todayLabel}
              {cadencePreview && (
                <span className="ml-2 text-zinc-600">&middot; {cadencePreview}</span>
              )}
            </p>
          </div>

          {coachAssignment && (() => {
            const slug = coachAssignment.coach.coachProfile?.slug;
            const isPublished = coachAssignment.coach.coachProfile?.isPublished;
            const badge = (
              <div className={`flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-zinc-800/80 px-3.5 py-1.5 ${slug && isPublished ? "transition-colors hover:border-white/[0.14] hover:bg-zinc-700/80" : ""}`}>
                <div className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-zinc-700">
                  {coachAvatarUrl ? (
                    <Image src={coachAvatarUrl} alt="" width={24} height={24} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-zinc-300">
                      {coachInitial}
                    </div>
                  )}
                </div>
                <span className="text-xs font-medium text-zinc-400">
                  {coachAssignment.coach.firstName ? `coached by ${coachAssignment.coach.firstName}` : "Your Coach"}
                </span>
              </div>
            );
            return slug && isPublished ? (
              <Link href={`/coaches/${slug}`}>{badge}</Link>
            ) : badge;
          })()}
        </div>
      </section>

      {/* Team banner */}
      <ClientTeamBanner clientId={user.id} />

      {/* Coach connection (only if no coach) */}
      {!coachAssignment && (
        <>
          {await (async () => {
            const myRequests = await getMyCoachingRequests();
            return myRequests.length > 0 ? <MyRequestsCard requests={myRequests} /> : null;
          })()}
          <ConnectCoachBanner />
        </>
      )}

      {/* Intake questionnaire banner */}
      {pendingIntake && (pendingIntake.status === "PENDING" || pendingIntake.status === "IN_PROGRESS") && (
        <div className="animate-fade-in" style={{ animationDelay: "40ms" }}>
          <Link
            href="/client/intake"
            className="group flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-blue-500/20 bg-blue-950/30 px-6 py-5 transition-all hover:border-blue-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                {pendingIntake.status === "IN_PROGRESS" ? "Continue Intake" : "Action Required"}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-blue-100">
                {pendingIntake.status === "IN_PROGRESS"
                  ? "Your intake is in progress"
                  : "Your coach sent you an intake questionnaire"}
              </p>
              <p className="mt-0.5 text-xs text-blue-400/70">
                {pendingIntake.status === "IN_PROGRESS"
                  ? "Pick up where you left off"
                  : "Provide your baseline stats and goals to get started"}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-blue-400 transition-transform group-hover:translate-x-0.5">
              {pendingIntake.status === "IN_PROGRESS" ? "Continue →" : "Start →"}
            </span>
          </Link>
        </div>
      )}

      {/* Testimonial prompt */}
      {coachAssignment && await (async () => {
        const eligibility = await getTestimonialEligibility(user.id);
        if (!eligibility.coachId) return null;
        return (
          <TestimonialPrompt
            coachId={eligibility.coachId}
            coachName={eligibility.coachName!}
            hasExisting={!eligibility.eligible}
          />
        );
      })()}

      {/* Check-in CTA — overdue banner first (most urgent) */}
      {coachAssignment && cadenceResult && (cadenceResult.status === "due" || cadenceResult.status === "overdue") && (
        <div className="animate-fade-in" style={{ animationDelay: "80ms" }}>
          <CheckInScheduleBanner
            cadenceStatus={cadenceResult.status}
            statusLabel={cadenceResult.label}
            nextDueLabel={nextDueLabel}
            latestReviewedCheckInId={latestCheckIn?.status === "REVIEWED" ? latestCheckIn.id : undefined}
          />
        </div>
      )}

      {/* Check-in status (submitted / reviewed / none — suppressed when overdue already shown) */}
      {cadenceResult?.status !== "overdue" && (
        <div className="animate-fade-in" style={{ animationDelay: "100ms" }}>
          <CheckInStatus
            status={weekStatus}
            weekLabel={todayLabel}
            statusLabel={statusLabel}
            nextDueLabel={nextDueLabel}
            checkInDate={
              latestCheckIn
                ? latestCheckIn.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : undefined
            }
            checkInId={latestCheckIn?.id}
          />
        </div>
      )}

      {/* Your Program — 2-card grid */}
      {(mealPlan || (trainingProgram && trainingProgram.days.length > 0)) && (
        <section
          className="animate-fade-in"
          style={{ animationDelay: "60ms" }}
          aria-labelledby="plans-heading"
        >
          <h2
            id="plans-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
          >
            Your Program
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {mealPlan ? (
              <Link
                href="/client/meal-plan"
                className="group flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 transition-all hover:border-blue-500/20 hover:shadow-lg hover:shadow-zinc-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
                aria-label="View your nutrition plan"
                style={{ minHeight: "100px" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Nutrition</p>
                <p className="text-sm font-bold text-zinc-100">Meal Plan</p>
                <span className="mt-auto text-xs font-medium text-zinc-500 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
                  Open Plan →
                </span>
              </Link>
            ) : (
              <div className="flex flex-col gap-2 overflow-hidden rounded-2xl border border-dashed border-zinc-800 bg-[#0a1224] p-5" style={{ minHeight: "100px" }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/60">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Nutrition</p>
                <p className="text-sm text-zinc-600">Not yet assigned</p>
              </div>
            )}

            {trainingProgram && trainingProgram.days.length > 0 ? (
              <Link
                href="/client/training"
                className="group flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 transition-all hover:border-emerald-500/20 hover:shadow-lg hover:shadow-zinc-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
                aria-label="View your training program"
                style={{ minHeight: "100px" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true"><path d="M6 5v11"/><path d="M18 5v11"/><path d="M2 9h4"/><path d="M18 9h4"/><path d="M2 15h4"/><path d="M18 15h4"/><path d="M6 9h12"/><path d="M6 15h12"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Training</p>
                <p className="text-sm font-bold text-zinc-100">Workout Program</p>
                <span className="mt-auto text-xs font-medium text-zinc-500 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
                  Open Program →
                </span>
              </Link>
            ) : (
              <div className="flex flex-col gap-2 overflow-hidden rounded-2xl border border-dashed border-zinc-800 bg-[#0a1224] p-5" style={{ minHeight: "100px" }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/60">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600" aria-hidden="true"><path d="M6 5v11"/><path d="M18 5v11"/><path d="M2 9h4"/><path d="M18 9h4"/><path d="M2 15h4"/><path d="M18 15h4"/><path d="M6 9h12"/><path d="M6 15h12"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Training</p>
                <p className="text-sm text-zinc-600">Not yet assigned</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Cardio Prescription strip */}
      {(() => {
        const cardioDay = trainingProgram?.days?.find((d) => d.dayName === "__CARDIO__");
        const b = cardioDay?.blocks?.[0];
        if (!b) return null;
        const [modality = "", frequency = "", duration = "", intensity = ""] = (b.title ?? "").split("|");
        if (!modality && !frequency && !duration && !intensity) return null;
        const chips = [
          modality && { label: "Type", value: modality.trim() },
          frequency && { label: "Frequency", value: frequency.trim() },
          duration && { label: "Duration", value: duration.trim() },
          intensity && { label: "Intensity", value: intensity.trim() },
        ].filter(Boolean) as { label: string; value: string }[];
        return (
          <section className="animate-fade-in" style={{ animationDelay: "70ms" }} aria-label="Cardio prescription">
            <div className="rounded-2xl border border-green-500/20 bg-green-500/[0.05] px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-green-400">Cardio Prescription</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {chips.map(({ label, value }) => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300">
                    <span className="font-normal text-green-500/60">{label}</span>
                    {value}
                  </span>
                ))}
              </div>
              {b.content && (
                <p className="mt-2.5 text-xs leading-relaxed text-green-400/60">{b.content}</p>
              )}
            </div>
          </section>
        );
      })()}

      {/* Coach Rules card */}
      {coachRules.length > 0 && (
        <div className="animate-fade-in" style={{ animationDelay: "120ms" }}>
          <CoachRulesCard rules={coachRules} />
        </div>
      )}

      {/* Weight */}
      {latestWeight?.weight && (
        <section
          className="animate-fade-in overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6"
          style={{ animationDelay: "180ms" }}
          aria-label="Weight overview"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Current Weight
          </p>
          <div className="mt-2.5 flex items-baseline gap-2">
            <p className="font-mono text-4xl font-bold tabular-nums tracking-tight text-zinc-100">
              {latestWeight.weight}
            </p>
            <span className="text-sm font-medium text-zinc-400">lbs</span>
            {weightDelta != null && weightDelta !== 0 && (
              <span
                className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${weightDelta < 0
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/20 text-amber-400"
                  }`}
              >
                {weightDelta < 0 ? "\u2193" : "\u2191"} {Math.abs(weightDelta)} lbs
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">
            as of {latestWeight.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
          <WeightProgress
            data={weightHistory}
            clientId={user.id}
            className="mt-5"
          />
        </section>
      )}

      {/* Today Adherence */}
      {adherenceEnabled && (
        <div className="animate-fade-in" style={{ animationDelay: "140ms" }}>
          <TodayAdherence
            date={todayDate}
            planMeals={planMeals}
            existingMeals={todayAdherence?.meals ?? []}
            workoutCompleted={todayAdherence?.workoutCompleted ?? false}
          />
        </div>
      )}

      {/* Recent Check-Ins — flat list with submission dates */}
      <section
        className="animate-fade-in"
        style={{ animationDelay: "400ms" }}
        aria-labelledby="checkins-heading"
      >
        <h2
          id="checkins-heading"
          className="mb-5 text-lg font-semibold tracking-tight"
        >
          Recent Check-Ins
        </h2>
        {checkIns.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-700 bg-[#0a1224] px-8 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /></svg>
            </div>
            <div>
              <p className="text-sm font-semibold">No check-ins yet</p>
              <Link
                href="/client/check-in"
                className="mt-1.5 inline-block text-sm font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              >
                Submit your first check-in
              </Link>
            </div>
          </div>
        ) : (
          <div className="stagger-children space-y-3">
            {checkIns.map((checkIn, idx) => {
              const prev = checkIns[idx + 1];
              const delta =
                prev?.weight && checkIn.weight
                  ? +(checkIn.weight - prev.weight).toFixed(1)
                  : null;

              const dateLabel = checkIn.submittedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });

              return (
                <div
                  key={checkIn.id}
                  className="relative rounded-2xl border border-white/[0.06] bg-[#0a1224] transition-all hover:border-blue-500/20"
                >
                  {/* Overflow menu — top right */}
                  <div className="absolute right-1 top-1 z-10 sm:right-2 sm:top-2">
                    <DeleteCheckInButton checkInId={checkIn.id} />
                  </div>

                  <Link
                    href={`/client/check-ins/${checkIn.id}`}
                    className="block rounded-2xl px-4 py-3.5 pr-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 sm:px-5 sm:py-4"
                    aria-label={`View check-in from ${dateLabel}`}
                  >
                    {/* Mobile: stacked | Desktop: horizontal */}
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                      {/* Weight + delta */}
                      <div className="flex items-baseline gap-2">
                        {checkIn.weight ? (
                          <p className="text-xl font-bold tabular-nums leading-tight tracking-tight">
                            {checkIn.weight}
                            <span className="ml-0.5 text-[10px] font-normal text-zinc-400">lbs</span>
                          </p>
                        ) : (
                          <p className="text-xl font-bold text-zinc-700">
                            &mdash;
                          </p>
                        )}
                        {delta != null && delta !== 0 && (
                          <span
                            className={`text-xs font-semibold ${delta < 0
                              ? "text-emerald-500"
                              : "text-red-400"
                              }`}
                          >
                            {delta < 0 ? "\u2193" : "\u2191"} {Math.abs(delta)}
                          </span>
                        )}
                      </div>

                      {/* Date + meta row */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-300">
                          {dateLabel}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                          {checkIn._count.photos > 0 && (
                            <span>{checkIn._count.photos} photo{checkIn._count.photos > 1 ? "s" : ""}</span>
                          )}
                          {checkIn.notes && (
                            <span className="truncate max-w-[200px] sm:max-w-[180px]">{checkIn.notes}</span>
                          )}
                        </div>
                      </div>

                      {/* Status badge */}
                      <span
                        className={`self-start shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:self-center ${checkIn.status === "REVIEWED"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400"
                          }`}
                      >
                        {checkIn.status === "REVIEWED" ? "Reviewed" : "Pending"}
                      </span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Coach Feedback */}
      {latestCoachMessage && (
        <Link
          href={`/client/messages/${formatDateUTC(latestCoachMessage.weekOf)}`}
          className="group animate-fade-in block overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 transition-all hover:border-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
          style={{ animationDelay: "160ms" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Coach Feedback
            </p>
            <span className="text-xs font-medium text-zinc-400 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
              View →
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-300 line-clamp-2">
            {latestCoachMessage.body}
          </p>
        </Link>
      )}

      {/* Become a Coach */}
      {!user.isCoach && (
        <div className="animate-fade-in" style={{ animationDelay: "200ms" }}>
          <BecomeCoachForm />
        </div>
      )}
    </div>
  );
}
