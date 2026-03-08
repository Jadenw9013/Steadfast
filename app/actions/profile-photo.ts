"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function confirmProfilePhoto(storagePath: string) {
    const user = await getCurrentDbUser();

    // Validate storage path belongs to this user
    const expectedPrefix = `${user.id}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
        throw new Error("Invalid storage path");
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

    await db.user.update({
        where: { id: user.id },
        data: { profilePhotoPath: null },
    });

    revalidatePath("/coach/marketplace/profile");
    revalidatePath("/client/profile");
    revalidatePath("/client");
    return { success: true };
}
