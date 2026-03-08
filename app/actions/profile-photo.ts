"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { deleteProfilePhoto } from "@/lib/supabase/profile-photo-storage";

export async function confirmProfilePhoto(storagePath: string) {
    const user = await getCurrentDbUser();

    // Validate storage path belongs to this user
    const expectedPrefix = `${user.id}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
        throw new Error("Invalid storage path");
    }

    // Delete old file from storage if replacing
    if (user.profilePhotoPath && user.profilePhotoPath !== storagePath) {
        await deleteProfilePhoto(user.profilePhotoPath).catch(() => { });
    }

    await db.user.update({
        where: { id: user.id },
        data: { profilePhotoPath: storagePath },
    });

    revalidatePath("/coach/marketplace/profile");
    revalidatePath("/client/profile");
    revalidatePath("/client");
    return { success: true };
}

export async function removeProfilePhoto() {
    const user = await getCurrentDbUser();

    if (!user.profilePhotoPath) return { success: true };

    // Delete from storage
    await deleteProfilePhoto(user.profilePhotoPath).catch(() => { });

    await db.user.update({
        where: { id: user.id },
        data: { profilePhotoPath: null },
    });

    revalidatePath("/coach/marketplace/profile");
    revalidatePath("/client/profile");
    revalidatePath("/client");
    return { success: true };
}

// ── Banner Photo Actions ──

export async function confirmBannerPhoto(storagePath: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const expectedPrefix = `${user.id}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
        throw new Error("Invalid storage path");
    }

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { bannerPhotoPath: true },
    });

    // Delete old banner from storage
    if (profile?.bannerPhotoPath && profile.bannerPhotoPath !== storagePath) {
        await deleteProfilePhoto(profile.bannerPhotoPath).catch(() => { });
    }

    await db.coachProfile.update({
        where: { userId: user.id },
        data: { bannerPhotoPath: storagePath },
    });

    revalidatePath("/coach/marketplace/profile");
    return { success: true };
}

export async function removeBannerPhoto() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { bannerPhotoPath: true },
    });

    if (!profile?.bannerPhotoPath) return { success: true };

    await deleteProfilePhoto(profile.bannerPhotoPath).catch(() => { });

    await db.coachProfile.update({
        where: { userId: user.id },
        data: { bannerPhotoPath: null },
    });

    revalidatePath("/coach/marketplace/profile");
    return { success: true };
}
