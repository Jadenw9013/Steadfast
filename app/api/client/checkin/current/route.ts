import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  parseCadenceConfig,
  getEffectiveCadence,
  getClientCadenceStatus,
  cadenceFromLegacyDays,
  type CadenceConfig,
} from "@/lib/scheduling/cadence";
import { getCurrentWeekMonday, formatDateUTC } from "@/lib/utils/date";

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

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const tz = user.timezone || "America/Los_Angeles";
    const weekOf = getCurrentWeekMonday();

    // ── Coach cadence (for period date computation) ───────────────────────
    const coachAssignment = await db.coachClient.findFirst({
      where: { clientId: user.id },
      select: {
        cadenceConfig: true,
        coach: {
          select: { checkInDaysOfWeek: true, cadenceConfig: true },
        },
      },
    });

    // ── Latest check-in (for cadence status + "current period" check) ─────
    const latestCheckIn = await db.checkIn.findFirst({
      where: { clientId: user.id, deletedAt: null },
      orderBy: { submittedAt: "desc" },
      select: { id: true, submittedAt: true, status: true },
    });

    // ── Compute period dates from cadence ─────────────────────────────────
    let periodStart: string;
    let periodEnd: string;

    const coachCadence = coachAssignment
      ? parseCadenceConfig(coachAssignment.coach.cadenceConfig)
      : null;
    const clientOverride = coachAssignment
      ? parseCadenceConfig(coachAssignment.cadenceConfig)
      : null;
    const effectiveCadence = coachAssignment
      ? getEffectiveCadence(
          coachCadence ??
            cadenceFromLegacyDays(coachAssignment.coach.checkInDaysOfWeek),
          clientOverride
        )
      : null;

    const cadenceResult = effectiveCadence
      ? getClientCadenceStatus(
          effectiveCadence,
          latestCheckIn
            ? { submittedAt: latestCheckIn.submittedAt, status: latestCheckIn.status }
            : null,
          tz
        )
      : null;

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

    // ── Current period check-in: submitted after the period start ─────────
    const periodStartDate = new Date(periodStart + "T00:00:00Z");

    const currentCheckIn = await db.checkIn.findFirst({
      where: {
        clientId: user.id,
        deletedAt: null,
        submittedAt: { gte: periodStartDate },
      },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        weekOf: true,
        status: true,
        weight: true,
        bodyFatPct: true,
        dietCompliance: true,
        energyLevel: true,
        notes: true,
        periodStartDate: true,
        periodEndDate: true,
        timezone: true,
        templateSnapshot: true,
        customResponses: true,
        photos: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, storagePath: true },
        },
      },
    });

    return NextResponse.json({
      checkIn: currentCheckIn
        ? {
            id: currentCheckIn.id,
            weekOf: currentCheckIn.weekOf.toISOString(),
            status: currentCheckIn.status,
            weight: currentCheckIn.weight,
            bodyFatPct: currentCheckIn.bodyFatPct,
            dietCompliance: currentCheckIn.dietCompliance,
            energyLevel: currentCheckIn.energyLevel,
            notes: currentCheckIn.notes,
            periodStartDate: currentCheckIn.periodStartDate,
            periodEndDate: currentCheckIn.periodEndDate,
            timezone: currentCheckIn.timezone,
            templateSnapshot: currentCheckIn.templateSnapshot,
            customResponses: currentCheckIn.customResponses,
            photos: currentCheckIn.photos.map((p) => ({
              id: p.id,
              path: p.storagePath,
            })),
          }
        : null,
      periodDates: {
        periodStart,
        periodEnd,
        weekOf: weekOf.toISOString(),
      },
    });
  } catch (err) {
    console.error("[GET /api/client/checkin/current]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
