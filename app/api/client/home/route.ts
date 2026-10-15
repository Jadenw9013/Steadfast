import { getClientProvider, isClientProviderCurrent } from "@/lib/queries/client-provider";
import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { getClientCheckInsLight } from "@/lib/queries/check-ins";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { getMyIntake } from "@/lib/queries/client-intake";
import {
  getAdherenceEnabled,
  getTodayAdherence,
} from "@/lib/queries/adherence";
import { getActiveMealNames } from "@/lib/meal-plans/active-plan";
import {
  parseCadenceConfig,
  getEffectiveCadence,
  getClientCadenceStatus,
  cadenceFromLegacyDays,
  getCadencePreview,
  type CadenceConfig,
} from "@/lib/scheduling/cadence";
import {
  getCurrentWeekMonday,
  formatDateUTC,
  getLocalDate,
} from "@/lib/utils/date";

function getIntervalMs(config: CadenceConfig): number {
  switch (config.type) {
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "every_n_days":
      return config.intervalDays * 24 * 60 * 60 * 1000;
    case "every_n_hours":
      return config.intervalHours * 60 * 60 * 1000;
  }
}

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.activeRole !== "CLIENT" && !user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const provider = await getClientProvider(user.id);
    if (provider.resolutionRequired || provider.origin === "AI") return NextResponse.json({ error: provider.resolutionRequired ? "Your coaching provider needs resolution." : "Update Steadfast to use the AI Coach workspace." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    // ── Coach assignment (explicit select — P2022 safety) ─────────────────
    const coachAssignment = await db.coachClient.findFirst({
      where: { clientId: user.id, id: provider.activeCoachClientId ?? "unassigned" },
      select: {
        id: true,
        cadenceConfig: true,
        coach: {
          select: {
            id: true,
            clerkId: true,
            firstName: true,
            lastName: true,
            profilePhotoPath: true,
            checkInDaysOfWeek: true,
            cadenceConfig: true,
            coachProfile: { select: { slug: true } },
          },
        },
      },
    });

    // ── Timezone + today ──────────────────────────────────────────────────
    const tz = user.timezone || "America/Los_Angeles";
    const todayDate = getLocalDate(new Date(), tz);
    const weekOf = getCurrentWeekMonday();

    // ── Parallel data fetches ─────────────────────────────────────────────
    const [
      checkIns,
      mealPlan,
      trainingProgram,
      intake,
      adherenceEnabled,
      todayAdherence,
      mealNames,
      latestMessage,
      legacyOnboarding,
    ] = await Promise.all([
      getClientCheckInsLight(user.id),
      provider.origin === "HUMAN" ? getCurrentPublishedMealPlan(user.id, provider.relationshipStartedAt!) : Promise.resolve(null),
      provider.origin === "HUMAN" ? getPublishedTrainingProgram(user.id, provider.relationshipStartedAt!) : Promise.resolve(null),
      getMyIntake(user.id),
      getAdherenceEnabled(user.id),
      getTodayAdherence(user.id, todayDate),
      // `relationshipStartedAt` is already null for every non-HUMAN provider,
      // so no `origin === "HUMAN"` ternary is needed here (T-105).
      getActiveMealNames(user.id, provider.relationshipStartedAt),
      db.message.findFirst({
        where: { clientId: user.id, weekOf },
        orderBy: { createdAt: "desc" },
        select: { id: true, body: true, senderId: true, createdAt: true },
      }),
      db.onboardingResponse.findUnique({
        where: { clientId: user.id },
        select: { id: true },
      }),
    ]);

    if (!await isClientProviderCurrent(user.id, provider)) return NextResponse.json({ error: "Your provider changed. Refresh to continue." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });

    // ── Cadence status (mirrors app/client/page.tsx exactly) ─────────────
    const coachCadence = coachAssignment
      ? parseCadenceConfig(coachAssignment.coach.cadenceConfig)
      : null;
    const clientCadenceOverride = coachAssignment
      ? parseCadenceConfig(coachAssignment.cadenceConfig)
      : null;
    const effectiveCadence = coachAssignment
      ? getEffectiveCadence(
          coachCadence ??
            cadenceFromLegacyDays(coachAssignment.coach.checkInDaysOfWeek),
          clientCadenceOverride
        )
      : null;

    const latestCheckIn = checkIns[0] ?? null;
    const cadenceResult =
      effectiveCadence
        ? getClientCadenceStatus(
            effectiveCadence,
            latestCheckIn
              ? {
                  submittedAt: latestCheckIn.submittedAt,
                  status: latestCheckIn.status,
                }
              : null,
            tz
          )
        : null;

    const cadencePreview = effectiveCadence
      ? getCadencePreview(effectiveCadence)
      : "No schedule set";

    // Derive period bounds from cadence interval
    let periodStart: string;
    let periodEnd: string;
    if (cadenceResult && effectiveCadence) {
      const intervalMs = getIntervalMs(effectiveCadence);
      periodEnd = formatDateUTC(cadenceResult.nextDue);
      periodStart = formatDateUTC(
        new Date(cadenceResult.nextDue.getTime() - intervalMs)
      );
    } else {
      periodStart = formatDateUTC(weekOf);
      periodEnd = formatDateUTC(
        new Date(weekOf.getTime() + 6 * 24 * 60 * 60 * 1000)
      );
    }

    // ── Intake status ─────────────────────────────────────────────────────
    let intakeStatus: "NONE" | "PENDING" | "IN_PROGRESS" | "COMPLETED" =
      "NONE";
    if (intake) {
      intakeStatus = intake.status; // PENDING | IN_PROGRESS | COMPLETED
    } else if (legacyOnboarding) {
      intakeStatus = "COMPLETED";
    }

    // ── Response ──────────────────────────────────────────────────────────
    return NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        timezone: user.timezone,
        profilePhotoPath: user.profilePhotoPath,
      },
      coachAssignment: coachAssignment
        ? await (async () => {
            // Resolve coach photo — priority: Supabase signed URL > Clerk imageUrl
            let coachProfilePhotoUrl: string | null = null;
            let coachImageUrl: string | null = null;

            // 1. Try Supabase signed URL (matches website source of truth)
            if (coachAssignment.coach.profilePhotoPath) {
              try {
                const supabase = createClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.SUPABASE_SERVICE_ROLE_KEY!
                );
                const { data } = await supabase.storage
                  .from("profile-photos")
                  .createSignedUrl(coachAssignment.coach.profilePhotoPath, 3600);
                if (data?.signedUrl) coachProfilePhotoUrl = data.signedUrl;
              } catch {
                // Non-critical
              }
            }

            // 2. Clerk imageUrl (no hasImage gate — works for all user types)
            try {
              const clerk = await clerkClient();
              const clerkUser = await clerk.users.getUser(coachAssignment.coach.clerkId);
              coachImageUrl = clerkUser.imageUrl ?? null;
            } catch {
              // Non-critical — initials fallback applies
            }

            return {
              coach: {
                id: coachAssignment.coach.id,
                firstName: coachAssignment.coach.firstName,
                lastName: coachAssignment.coach.lastName,
                profilePhotoPath: coachAssignment.coach.profilePhotoPath,
                profilePhotoUrl: coachProfilePhotoUrl,  // Supabase signed URL (1hr TTL)
                imageUrl: coachImageUrl,                 // Clerk CDN (always valid)
                slug: coachAssignment.coach.coachProfile?.slug ?? null,
              },
            };
          })()
        : null,
      weekStatus: {
        cadenceStatus: cadenceResult?.status ?? "upcoming",
        cadencePreview,
        weekOf: weekOf.toISOString(),
        periodStart,
        periodEnd,
      },
      mealPlan: mealPlan
        ? {
            id: mealPlan.id,
            status: mealPlan.status,
            weekOf: mealPlan.weekOf.toISOString(),
          }
        : null,
      trainingProgram: trainingProgram
        ? {
            id: trainingProgram.id,
            status: trainingProgram.status,
            weekOf: trainingProgram.weekOf.toISOString(),
            days: trainingProgram.days.map((d) => ({
              id: d.id,
              dayName: d.dayName,
              sortOrder: d.sortOrder,
            })),
          }
        : null,
      latestMessage: latestMessage
        ? {
            id: latestMessage.id,
            content: latestMessage.body,
            senderId: latestMessage.senderId,
            createdAt: latestMessage.createdAt.toISOString(),
          }
        : null,
      intakeStatus,
      adherence: {
        enabled: adherenceEnabled,
        todayEntry: todayAdherence
          ? {
              id: todayAdherence.id,
              meals: todayAdherence.meals,
              workoutCompleted: todayAdherence.workoutCompleted,
            }
          : null,
        mealNames: mealNames.map((m) => m.mealName),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[GET /api/client/home]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
