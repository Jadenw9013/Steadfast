"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { revalidatePath } from "next/cache";
import { deletePortfolioMedia } from "@/lib/supabase/portfolio-storage";
import {
    createPortfolioItemSchema,
    updatePortfolioItemSchema,
    reorderPortfolioItemsSchema,
} from "@/lib/validations/portfolio-item";

const profileSchema = z.object({
    slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, "Slug must only contain lowercase letters, numbers, and hyphens"),
    headline: z.string().max(100).optional().nullable(),
    bio: z.string().max(1000).optional().nullable(),
    specialties: z.array(z.string()).max(10),
    pricing: z.string().max(100).optional().nullable(),
    acceptingClients: z.boolean().default(true),
    isPublished: z.boolean().default(false),
    welcomeMessage: z.string().max(300, "Welcome message max 300 characters").optional().nullable(),
});

export type ProfileFormData = z.infer<typeof profileSchema>;

export async function getCoachProfile() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
    });

    return profile;
}

export async function upsertCoachProfile(data: ProfileFormData) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const validated = profileSchema.parse(data);

    // Check for slug uniqueness
    const existingWithSlug = await db.coachProfile.findUnique({
        where: { slug: validated.slug },
    });

    if (existingWithSlug && existingWithSlug.userId !== user.id) {
        throw new Error("Slug is already taken");
    }

    const profile = await db.coachProfile.upsert({
        where: { userId: user.id },
        create: {
            userId: user.id,
            slug: validated.slug,
            headline: validated.headline,
            bio: validated.bio,
            specialties: validated.specialties,
            pricing: validated.pricing,
            acceptingClients: validated.acceptingClients,
            isPublished: validated.isPublished,
            welcomeMessage: validated.welcomeMessage,
        },
        update: {
            slug: validated.slug,
            headline: validated.headline,
            bio: validated.bio,
            specialties: validated.specialties,
            pricing: validated.pricing,
            acceptingClients: validated.acceptingClients,
            isPublished: validated.isPublished,
            welcomeMessage: validated.welcomeMessage,
        },
    });

    revalidatePath("/coach/marketplace/profile");
    revalidatePath("/coaches");
    revalidatePath(`/coaches/${profile.slug}`);

    return profile;
}

// ── Portfolio Item CRUD ─────────────────────────────────────────────────────

export async function createPortfolioItem(data: z.infer<typeof createPortfolioItemSchema>) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const validated = createPortfolioItemSchema.parse(data);

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
    });
    if (!profile) throw new Error("Create a marketplace profile first");

    // Get next sort order
    const maxOrder = await db.portfolioItem.findFirst({
        where: { coachProfileId: profile.id },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
    });

    const item = await db.portfolioItem.create({
        data: {
            coachProfileId: profile.id,
            title: validated.title,
            result: validated.result,
            description: validated.description,
            category: validated.category,
            mediaPath: validated.mediaPath,
            mediaType: validated.mediaType,
            sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
        },
    });

    revalidatePath("/coach/marketplace/profile");
    revalidatePath("/coaches");
    return item;
}

export async function updatePortfolioItem(data: z.infer<typeof updatePortfolioItemSchema>) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const validated = updatePortfolioItemSchema.parse(data);

    // Verify ownership
    const item = await db.portfolioItem.findUnique({
        where: { id: validated.id },
        include: { coachProfile: true },
    });

    if (!item || item.coachProfile.userId !== user.id) {
        throw new Error("Portfolio item not found");
    }

    const updated = await db.portfolioItem.update({
        where: { id: validated.id },
        data: {
            title: validated.title,
            result: validated.result,
            description: validated.description,
            category: validated.category,
            mediaPath: validated.mediaPath,
            mediaType: validated.mediaType,
        },
    });

    revalidatePath("/coach/marketplace/profile");
    return updated;
}

export async function deletePortfolioItem(itemId: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const item = await db.portfolioItem.findUnique({
        where: { id: itemId },
        include: { coachProfile: true },
    });

    if (!item || item.coachProfile.userId !== user.id) {
        throw new Error("Portfolio item not found");
    }

    // Cleanup storage if media exists
    if (item.mediaPath) {
        await deletePortfolioMedia(item.mediaPath);
    }

    await db.portfolioItem.delete({
        where: { id: itemId },
    });

    revalidatePath("/coach/marketplace/profile");
}

export async function removePortfolioItemMedia(itemId: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const item = await db.portfolioItem.findUnique({
        where: { id: itemId },
        include: { coachProfile: true },
    });

    if (!item || item.coachProfile.userId !== user.id) {
        throw new Error("Portfolio item not found");
    }

    if (item.mediaPath) {
        await deletePortfolioMedia(item.mediaPath);
    }

    await db.portfolioItem.update({
        where: { id: itemId },
        data: { mediaPath: null, mediaType: null },
    });

    revalidatePath("/coach/marketplace/profile");
}

export async function reorderPortfolioItems(data: z.infer<typeof reorderPortfolioItemsSchema>) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const validated = reorderPortfolioItemsSchema.parse(data);

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
    });
    if (!profile) throw new Error("Profile not found");

    // Verify all items belong to this coach
    const items = await db.portfolioItem.findMany({
        where: { coachProfileId: profile.id },
        select: { id: true },
    });
    const ownedIds = new Set(items.map((i) => i.id));

    for (const id of validated.itemIds) {
        if (!ownedIds.has(id)) {
            throw new Error("Unauthorized item reorder");
        }
    }

    // Update sort orders in a transaction
    await db.$transaction(
        validated.itemIds.map((id, index) =>
            db.portfolioItem.update({
                where: { id },
                data: { sortOrder: index },
            })
        )
    );

    revalidatePath("/coach/marketplace/profile");
}
