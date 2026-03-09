import { getCurrentDbUser } from "@/lib/auth/roles";
import { getClientCheckInsLight, getLatestCoachMessage, getCheckInForLocalDate } from "@/lib/queries/check-ins";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { formatDateUTC, getLocalDate } from "@/lib/utils/date";
import { getWeightHistory } from "@/lib/queries/weight-history";
import { parseCadenceConfig, getEffectiveCadence, getClientCadenceStatus, cadenceFromLegacyDays, getCadencePreview } from "@/lib/scheduling/cadence";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { db } from "@/lib/db";
import Link from "next/link";
import Image from "next/image";
import { ConnectCoachBanner } from "@/components/client/connect-coach-banner";
import { BecomeCoachForm } from "@/components/client/become-coach-form";
import { DeleteCheckInButton } from "@/components/client/delete-check-in-button";
import { CheckInStatus } from "@/components/client/check-in-status";
import { CheckInScheduleBanner } from "@/components/client/check-in-schedule-banner";
import { WeightProgress } from "@/components/charts/weight-progress";
import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
import timezonePlugin from "dayjs/plugin/timezone";

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

export default async function ClientDashboard() {
  const user = await getCurrentDbUser();

  const coachAssignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    include: {
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

  const [checkIns, mealPlan, latestCoachMessage, weightHistory, trainingProgram] = await Promise.all([
    getClientCheckInsLight(user.id),
    getCurrentPublishedMealPlan(user.id),
    getLatestCoachMessage(user.id),
    getWeightHistory(user.id),
    getPublishedTrainingProgram(user.id),
  ]);

  // ── Cadence-aware status derivation ──────────────────────────────────────
  const tz = user.timezone || "America/Los_Angeles";
  const todayLocalDate = getLocalDate(new Date(), tz);
  const todayCheckIn = await getCheckInForLocalDate(user.id, todayLocalDate);
  const checkedInToday = !!todayCheckIn;

  // Resolve effective cadence: client override → coach default → legacy fallback
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

  // Derive cadence status
  const latestCheckIn = checkIns[0] ?? null;
  const cadenceResult = effectiveCadence
    ? getClientCadenceStatus(
      effectiveCadence,
      latestCheckIn ? { submittedAt: latestCheckIn.submittedAt, status: latestCheckIn.status } : null,
      tz
    )
    : null;

  // Legacy-compatible status fallback for CheckInStatus component.
  // Only used when cadenceResult is null (no coach assignment). When cadence
  // is active, the cadence-aware statusLabel prop overrides the display text.
  const weekStatus: "none" | "submitted" | "reviewed" = !latestCheckIn
    ? "none"
    : latestCheckIn.status === "REVIEWED"
      ? "reviewed"
      : "submitted";

  // Date labels
  const todayLabel = dayjs(new Date()).tz(tz).format("MMM D, YYYY");
  const cadencePreview = effectiveCadence ? getCadencePreview(effectiveCadence) : null;

  // Determine status label and next-due label for the status component
  const statusLabel = cadenceResult?.label;
  const nextDueLabel = cadencePreview ?? undefined;

  // Latest weight for the performance module
  const latestWeight = checkIns.find((c) => c.weight != null);
  const prevWeight = latestWeight
    ? checkIns.find((c) => c.weight != null && c.id !== latestWeight.id)
    : null;
  const weightDelta =
    latestWeight?.weight && prevWeight?.weight
      ? +(latestWeight.weight - prevWeight.weight).toFixed(1)
      : null;

  // Resolve coach banner/avatar URLs
  let coachBannerUrl: string | null = null;
  let coachAvatarUrl: string | null = null;
  if (coachAssignment) {
    const bannerPath = coachAssignment.coach.coachProfile?.bannerPhotoPath;
    const avatarPath = coachAssignment.coach.profilePhotoPath;
    if (bannerPath) {
      try { coachBannerUrl = await getProfilePhotoUrl(bannerPath); } catch { /* */ }
    }
    if (avatarPath) {
      try { coachAvatarUrl = await getProfilePhotoUrl(avatarPath); } catch { /* */ }
    }
  }
  const coachInitial = coachAssignment?.coach.firstName?.[0] ?? "C";

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">
            {user.firstName ? `${user.firstName}\u2019s Week` : "Your Week"}
          </h1>
          {coachAssignment && (() => {
            const slug = coachAssignment.coach.coachProfile?.slug;
            const isPublished = coachAssignment.coach.coachProfile?.isPublished;
            const badge = (
              <div className={`flex items-center gap-2.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 dark:border-zinc-800 dark:bg-[#121215] ${slug && isPublished ? "transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/80" : ""}`}>
                <div className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  {coachAvatarUrl ? (
                    <Image src={coachAvatarUrl} alt="" width={24} height={24} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-zinc-500">
                      {coachInitial}
                    </div>
                  )}
                </div>
                <span className="text-xs font-medium text-zinc-500">
                  Coach {coachAssignment.coach.firstName}
                </span>
              </div>
            );
            return slug && isPublished ? (
              <Link href={`/coaches/${slug}`}>{badge}</Link>
            ) : badge;
          })()}
        </div>
        <p className="mt-1.5 text-sm text-zinc-500">
          {todayLabel}
          {cadencePreview && (
            <span className="ml-2 text-zinc-400">&middot; {cadencePreview}</span>
          )}
        </p>
      </section>



      {/* Coach connection (only if no coach) */}
      {!coachAssignment && <ConnectCoachBanner />}

      {/* Check-in schedule reminder — cadence-aware */}
      {coachAssignment && cadenceResult && (
        <div className="animate-fade-in" style={{ animationDelay: "60ms" }}>
          <CheckInScheduleBanner
            cadenceStatus={cadenceResult.status}
            statusLabel={cadenceResult.label}
            nextDueLabel={nextDueLabel}
            latestReviewedCheckInId={latestCheckIn?.status === "REVIEWED" ? latestCheckIn.id : undefined}
          />
        </div>
      )}

      {/* Action Banner */}
      <div className="animate-fade-in" style={{ animationDelay: "80ms" }}>
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

      {/* Performance Module — Weight */}
      {latestWeight?.weight && (
        <section
          className="animate-fade-in overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-6 dark:border-zinc-800/80 dark:bg-[#121215]"
          style={{ animationDelay: "160ms" }}
          aria-label="Weight overview"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Current Weight
          </p>
          <div className="mt-2.5 flex items-baseline gap-2">
            <p className="text-4xl font-bold tabular-nums tracking-tight">
              {latestWeight.weight}
            </p>
            <span className="text-sm font-medium text-zinc-400">lbs</span>
            {weightDelta != null && weightDelta !== 0 && (
              <span
                className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${weightDelta < 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                  : "bg-red-500/10 text-red-500 dark:bg-red-500/20 dark:text-red-400"
                  }`}
              >
                {weightDelta < 0 ? "\u2193" : "\u2191"} {Math.abs(weightDelta)} lbs
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-400">
            as of {latestWeight.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
          <WeightProgress
            data={weightHistory}
            clientId={user.id}
            className="mt-5"
          />
        </section>
      )}

      {/* Coach Feedback */}
      {latestCoachMessage && (
        <Link
          href={`/client/messages/${formatDateUTC(latestCoachMessage.weekOf)}`}
          className="group animate-fade-in block overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-6 transition-all hover:border-zinc-300 hover:shadow-lg hover:shadow-zinc-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700 dark:hover:shadow-zinc-950/30"
          style={{ animationDelay: "240ms" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Coach Feedback
            </p>
            <span className="text-xs font-medium text-zinc-400 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
              View &rarr;
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed line-clamp-2">
            {latestCoachMessage.body}
          </p>
        </Link>
      )}

      {/* Your Plans — 2-card grid */}
      {(mealPlan || (trainingProgram && trainingProgram.days.length > 0)) && (
        <section
          className="animate-fade-in"
          style={{ animationDelay: "280ms" }}
          aria-labelledby="plans-heading"
        >
          <h2
            id="plans-heading"
            className="mb-3 text-lg font-semibold tracking-tight"
          >
            Your Plans
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {mealPlan ? (
              <Link
                href="/client/meal-plan"
                className="group flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-5 transition-all hover:border-zinc-300 hover:shadow-lg hover:shadow-zinc-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700 dark:hover:shadow-zinc-950/30"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Meal Plan
                </p>
                <p className="text-sm font-semibold">
                  {mealPlan.items.length} item{mealPlan.items.length !== 1 ? "s" : ""}
                </p>
                {mealPlan.items[0] && (
                  <p className="text-xs text-zinc-400 truncate">{mealPlan.items[0].foodName}</p>
                )}
                <span className="mt-auto text-xs font-medium text-zinc-400 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
                  View &rarr;
                </span>
              </Link>
            ) : (
              <div className="flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-dashed border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#121215]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Meal Plan
                </p>
                <p className="text-sm text-zinc-400">Not yet assigned</p>
              </div>
            )}

            {trainingProgram && trainingProgram.days.length > 0 ? (
              <Link
                href="/client/training"
                className="group flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-5 transition-all hover:border-zinc-300 hover:shadow-lg hover:shadow-zinc-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700 dark:hover:shadow-zinc-950/30"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Training
                </p>
                <p className="text-sm font-semibold">
                  {trainingProgram.days.length} day
                  {trainingProgram.days.length !== 1 ? "s" : ""} this week
                </p>
                {trainingProgram.days[0] && (
                  <p className="text-xs text-zinc-400 truncate">{trainingProgram.days[0].dayName}</p>
                )}
                <span className="mt-auto text-xs font-medium text-zinc-400 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
                  View &rarr;
                </span>
              </Link>
            ) : (
              <div className="flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-dashed border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#121215]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Training
                </p>
                <p className="text-sm text-zinc-400">Not yet assigned</p>
              </div>
            )}
          </div>
        </section>
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
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-16 text-center dark:border-zinc-700 dark:bg-[#121215]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
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
                  className="flex items-center gap-4 rounded-2xl border border-zinc-200/80 bg-white transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700"
                >
                  <Link
                    href={`/client/check-ins/${checkIn.id}`}
                    className="flex flex-1 items-center gap-4 px-5 py-4 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
                    aria-label={`View check-in from ${dateLabel}`}
                  >
                    {/* Weight */}
                    <div className="w-16 shrink-0">
                      {checkIn.weight ? (
                        <p className="text-xl font-bold tabular-nums leading-tight tracking-tight">
                          {checkIn.weight}
                          <span className="ml-0.5 text-[10px] font-normal text-zinc-400">lbs</span>
                        </p>
                      ) : (
                        <p className="text-xl font-bold text-zinc-200 dark:text-zinc-700">
                          &mdash;
                        </p>
                      )}
                    </div>

                    {/* Date + delta + notes */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {dateLabel}
                        {delta != null && delta !== 0 && (
                          <span
                            className={`ml-2 text-xs font-semibold ${delta < 0
                              ? "text-emerald-500"
                              : "text-red-400"
                              }`}
                          >
                            {delta < 0 ? "\u2193" : "\u2191"} {Math.abs(delta)}
                          </span>
                        )}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                        {checkIn._count.photos > 0 && (
                          <span>{checkIn._count.photos} photo{checkIn._count.photos > 1 ? "s" : ""}</span>
                        )}
                        {checkIn.notes && (
                          <span className="truncate max-w-[180px]">{checkIn.notes}</span>
                        )}
                      </div>
                    </div>

                    {/* Status badge */}
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${checkIn.status === "REVIEWED"
                        ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                        }`}
                    >
                      {checkIn.status === "REVIEWED" ? "Reviewed" : "Pending"}
                    </span>
                  </Link>

                  {/* Delete button (separate from link) */}
                  <div className="shrink-0 pr-3">
                    <DeleteCheckInButton checkInId={checkIn.id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Become a Coach */}
      {!user.isCoach && (
        <div className="animate-fade-in" style={{ animationDelay: "480ms" }}>
          <BecomeCoachForm />
        </div>
      )}
    </div>
  );
}
