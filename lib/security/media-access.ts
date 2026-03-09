"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getSignedDownloadUrl } from "@/lib/supabase/storage";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PhotoWithUrl {
    id: string;
    storagePath: string;
    sortOrder: number;
    url: string;
}

// ── Core authorization layer ───────────────────────────────────────────────────

/**
 * Verify the current user is authorized to view a check-in's photos,
 * then return signed download URLs.
 *
 * Authorization rules:
 * - CLIENT: must own the check-in (clientId matches user.id)
 * - COACH: must be assigned to the check-in's client via CoachClient
 *
 * Throws on unauthorized access.
 */
export async function getAuthorizedCheckInPhotos(
    checkInId: string
): Promise<PhotoWithUrl[]> {
    const user = await getCurrentDbUser();

    const checkIn = await db.checkIn.findUnique({
        where: { id: checkInId },
        select: {
            clientId: true,
            deletedAt: true,
            photos: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, storagePath: true, sortOrder: true },
            },
        },
    });

    if (!checkIn || checkIn.deletedAt) {
        throw new Error("Check-in not found");
    }

    // ── Authorization ──────────────────────────────────────────────────────────
    if (user.activeRole === "CLIENT") {
        if (checkIn.clientId !== user.id) {
            throw new Error("Unauthorized: you can only view your own check-ins");
        }
    } else if (user.activeRole === "COACH") {
        const assignment = await db.coachClient.findUnique({
            where: {
                coachId_clientId: { coachId: user.id, clientId: checkIn.clientId },
            },
        });
        if (!assignment) {
            throw new Error("Unauthorized: not assigned to this client");
        }
    } else {
        throw new Error("Unauthorized role");
    }

    // ── Generate short-lived signed URLs ───────────────────────────────────────
    if (checkIn.photos.length === 0) return [];

    const photosWithUrls = await Promise.all(
        checkIn.photos.map(async (photo) => ({
            id: photo.id,
            storagePath: photo.storagePath,
            sortOrder: photo.sortOrder,
            url: await getSignedDownloadUrl(photo.storagePath),
        }))
    );

    return photosWithUrls;
}

/**
 * Get a full check-in record with authorized photo URLs.
 * Combines the data fetch with the authorization check.
 */
export async function getCheckInWithAuthorizedPhotos(checkInId: string) {
    const user = await getCurrentDbUser();

    const checkIn = await db.checkIn.findUnique({
        where: { id: checkInId },
        include: {
            client: true,
            photos: { orderBy: { sortOrder: "asc" } },
        },
    });

    if (!checkIn || checkIn.deletedAt) return null;

    // ── Authorization ──────────────────────────────────────────────────────────
    if (user.activeRole === "CLIENT") {
        if (checkIn.clientId !== user.id) {
            throw new Error("Unauthorized: you can only view your own check-ins");
        }
    } else if (user.activeRole === "COACH") {
        const assignment = await db.coachClient.findUnique({
            where: {
                coachId_clientId: { coachId: user.id, clientId: checkIn.clientId },
            },
        });
        if (!assignment) {
            throw new Error("Unauthorized: not assigned to this client");
        }
    } else {
        throw new Error("Unauthorized role");
    }

    // ── Generate short-lived signed URLs ───────────────────────────────────────
    const photosWithUrls = await Promise.all(
        checkIn.photos.map(async (photo) => ({
            ...photo,
            url: await getSignedDownloadUrl(photo.storagePath),
        }))
    );

    return { ...checkIn, photos: photosWithUrls };
}

/**
 * Get multiple check-ins for a client+week with authorized photo URLs.
 * Verifies the caller has access to the client.
 */
export async function getCheckInsForWeekAuthorized(
    clientId: string,
    weekOf: Date
) {
    const user = await getCurrentDbUser();

    // ── Authorization ──────────────────────────────────────────────────────────
    if (user.activeRole === "CLIENT") {
        if (clientId !== user.id) {
            throw new Error("Unauthorized: you can only view your own check-ins");
        }
    } else if (user.activeRole === "COACH") {
        const assignment = await db.coachClient.findUnique({
            where: {
                coachId_clientId: { coachId: user.id, clientId },
            },
        });
        if (!assignment) {
            throw new Error("Unauthorized: not assigned to this client");
        }
    } else {
        throw new Error("Unauthorized role");
    }

    const checkIns = await db.checkIn.findMany({
        where: { clientId, weekOf, deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: {
            client: true,
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
