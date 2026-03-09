import { db } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { getSignedDownloadUrl } from "@/lib/supabase/storage";
import { getCurrentWeekMonday } from "@/lib/utils/date";

export async function getClientCheckIns(clientId: string) {
  return db.checkIn.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { submittedAt: "desc" },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getClientCheckInsLight(clientId: string) {
  return db.checkIn.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      weekOf: true,
      weight: true,
      status: true,
      notes: true,
      createdAt: true,
      submittedAt: true,
      localDate: true,
      _count: { select: { photos: true } },
    },
  });
}

export async function getPreviousBodyweight(
  clientId: string,
  beforeWeekOf: Date
) {
  return db.checkIn.findFirst({
    where: {
      clientId,
      deletedAt: null,
      isPrimary: true,
      weekOf: { lt: beforeWeekOf },
      weight: { not: null },
    },
    orderBy: { weekOf: "desc" },
    select: { weight: true, weekOf: true },
  });
}

/** Latest check-in by submission time (for "Previous BW" display). */
export async function getLatestCheckIn(clientId: string) {
  return db.checkIn.findFirst({
    where: { clientId, deletedAt: null, weight: { not: null } },
    orderBy: { submittedAt: "desc" },
    select: { weight: true, submittedAt: true },
  });
}

/** Check if client already has a check-in for a given local date. */
export async function getCheckInForLocalDate(
  clientId: string,
  localDate: string
) {
  return db.checkIn.findFirst({
    where: { clientId, localDate, deletedAt: null },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedAt: true },
  });
}

export async function getLatestCoachMessage(clientId: string) {
  return db.message.findFirst({
    where: {
      clientId,
      sender: { isCoach: true },
    },
    orderBy: { createdAt: "desc" },
    select: { body: true, createdAt: true, weekOf: true },
  });
}

export async function getCheckInById(checkInId: string) {
  const checkIn = await db.checkIn.findUnique({
    where: { id: checkInId },
    include: {
      client: true,
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!checkIn || checkIn.deletedAt) return null;

  // Generate signed download URLs for photos
  const photosWithUrls = await Promise.all(
    checkIn.photos.map(async (photo) => ({
      ...photo,
      url: await getSignedDownloadUrl(photo.storagePath),
    }))
  );

  return { ...checkIn, photos: photosWithUrls };
}

export async function getCoachClients(coachId: string) {
  const assignments = await db.coachClient.findMany({
    where: { coachId },
    include: {
      client: {
        include: {
          checkIns: {
            where: { deletedAt: null },
            orderBy: { submittedAt: "desc" },
            take: 1,
            select: { weekOf: true, submittedAt: true },
          },
        },
      },
    },
  });

  return assignments.map((a) => ({
    id: a.client.id,
    firstName: a.client.firstName,
    lastName: a.client.lastName,
    email: a.client.email,
    latestCheckIn: a.client.checkIns[0] ?? null,
  }));
}

export async function getCoachClientsWithWeekStatus(coachId: string) {
  const weekOf = getCurrentWeekMonday();

  const assignments = await db.coachClient.findMany({
    where: { coachId },
    include: {
      client: {
        include: {
          checkIns: {
            where: { deletedAt: null },
            orderBy: { submittedAt: "desc" },
            take: 2,
            select: {
              id: true,
              status: true,
              weekOf: true,
              weight: true,
              dietCompliance: true,
              energyLevel: true,
              submittedAt: true,
            },
          },
          clientMessages: {
            where: { weekOf, senderId: { not: coachId } },
            select: { id: true },
          },
        },
      },
    },
  });

  return assignments.map((a) => {
    const latestCheckIn = a.client.checkIns[0] ?? null;
    const previousCheckIn = a.client.checkIns[1] ?? null;

    let weekStatus: "new" | "reviewed" | "missing";
    if (!latestCheckIn) {
      weekStatus = "missing";
    } else if (latestCheckIn.status === "REVIEWED") {
      weekStatus = "reviewed";
    } else {
      weekStatus = "new";
    }

    const weight = latestCheckIn?.weight ?? null;
    const weightChange =
      latestCheckIn?.weight != null && previousCheckIn?.weight != null
        ? +(latestCheckIn.weight - previousCheckIn.weight).toFixed(1)
        : null;

    return {
      id: a.client.id,
      firstName: a.client.firstName,
      lastName: a.client.lastName,
      email: a.client.email,
      weekStatus,
      hasClientMessage: a.client.clientMessages.length > 0,
      checkInId: latestCheckIn?.id ?? null,
      weekOf,
      weight,
      weightChange,
      dietCompliance: latestCheckIn?.dietCompliance ?? null,
      energyLevel: latestCheckIn?.energyLevel ?? null,
      submittedAt: latestCheckIn?.submittedAt ?? null,
    };
  });
}

export async function getCheckInByClientAndWeek(
  clientId: string,
  weekOf: Date
) {
  const checkIn = await db.checkIn.findFirst({
    where: {
      clientId,
      weekOf,
      deletedAt: null,
      isPrimary: true,
    },
    include: {
      client: true,
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!checkIn) return null;

  const photosWithUrls = await Promise.all(
    checkIn.photos.map(async (photo) => ({
      ...photo,
      url: await getSignedDownloadUrl(photo.storagePath),
    }))
  );

  return { ...checkIn, photos: photosWithUrls };
}

export async function getCheckInsByClientAndWeek(
  clientId: string,
  weekOf: Date
) {
  const checkIns = await db.checkIn.findMany({
    where: { clientId, weekOf, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });

  return Promise.all(
    checkIns.map(async (checkIn) => ({
      ...checkIn,
      photos: await Promise.all(
        checkIn.photos.map(async (photo) => ({
          ...photo,
          url: await getSignedDownloadUrl(photo.storagePath),
        }))
      ),
    }))
  );
}

export async function verifyCoachAccessToClient(clientId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const coach = await db.user.findUnique({ where: { clerkId: userId } });
  if (!coach || !coach.isCoach) throw new Error("Not a coach");

  const assignment = await db.coachClient.findUnique({
    where: {
      coachId_clientId: { coachId: coach.id, clientId },
    },
  });

  if (!assignment) throw new Error("Not assigned to this client");
  return coach;
}

export async function verifyCoachAccessToCheckIn(checkInId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const coach = await db.user.findUnique({ where: { clerkId: userId } });
  if (!coach || !coach.isCoach) throw new Error("Not a coach");

  const checkIn = await db.checkIn.findUnique({
    where: { id: checkInId },
    select: { clientId: true },
  });
  if (!checkIn) throw new Error("Check-in not found");

  const assignment = await db.coachClient.findUnique({
    where: {
      coachId_clientId: { coachId: coach.id, clientId: checkIn.clientId },
    },
  });

  if (!assignment) throw new Error("Not assigned to this client");
  return coach;
}
