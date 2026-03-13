"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { revalidatePath } from "next/cache";

const createTestimonialSchema = z.object({
    coachId: z.string(),
    rating: z.number().int().min(1).max(5),
    reviewText: z.string().max(2000).optional().default(""),
    anonymous: z.boolean().default(false),
    images: z.array(z.string()).max(4).default([]),
});

const updateTestimonialSchema = z.object({
    testimonialId: z.string(),
    rating: z.number().int().min(1).max(5),
    reviewText: z.string().max(2000).optional().default(""),
    anonymous: z.boolean().default(false),
    images: z.array(z.string()).max(4).default([]),
});

export async function createTestimonial(data: z.infer<typeof createTestimonialSchema>) {
    const user = await getCurrentDbUser();
    const validated = createTestimonialSchema.parse(data);

    // Verify the client has a coaching relationship with this coach
    const relationship = await db.coachClient.findFirst({
        where: {
            clientId: user.id,
            coachId: validated.coachId,
        },
    });

    if (!relationship) {
        throw new Error("You must be a client of this coach to leave a review.");
    }

    // Check for existing testimonial (unique constraint will also catch this)
    const existing = await db.testimonial.findUnique({
        where: {
            coachId_clientId: {
                coachId: validated.coachId,
                clientId: user.id,
            },
        },
    });

    if (existing) {
        throw new Error("You have already left a review for this coach. You can edit your existing review instead.");
    }

    const testimonial = await db.testimonial.create({
        data: {
            coachId: validated.coachId,
            clientId: user.id,
            rating: validated.rating,
            reviewText: validated.reviewText || "",
            anonymous: validated.anonymous,
            images: validated.images,
        },
    });

    // Revalidate the coach's public profile
    const coachProfile = await db.coachProfile.findUnique({
        where: { userId: validated.coachId },
        select: { slug: true },
    });

    if (coachProfile?.slug) {
        revalidatePath(`/coaches/${coachProfile.slug}`);
    }
    revalidatePath("/coaches");

    // Notify coach of new review (fire-and-forget, never block)
    try {
        const coach = await db.user.findUnique({
            where: { id: validated.coachId },
            select: { email: true, firstName: true, emailCoachingRequests: true },
        });
        if (coach?.emailCoachingRequests) {
            const { sendEmail } = await import("@/lib/email/sendEmail");
            const { newTestimonialEmail } = await import("@/lib/email/templates");
            const clientName = user.firstName || "A client";
            const coachName = coach.firstName || "Coach";
            const email = newTestimonialEmail(coachName, clientName);
            sendEmail({ to: coach.email, ...email }).catch(console.error);
        }
    } catch { /* email failure must never break testimonial creation */ }

    return testimonial;
}

export async function updateTestimonial(data: z.infer<typeof updateTestimonialSchema>) {
    const user = await getCurrentDbUser();
    const validated = updateTestimonialSchema.parse(data);

    // Verify ownership
    const existing = await db.testimonial.findUnique({
        where: { id: validated.testimonialId },
    });

    if (!existing || existing.clientId !== user.id) {
        throw new Error("Testimonial not found or unauthorized.");
    }

    const testimonial = await db.testimonial.update({
        where: { id: validated.testimonialId },
        data: {
            rating: validated.rating,
            reviewText: validated.reviewText || "",
            anonymous: validated.anonymous,
            images: validated.images,
        },
    });

    // Revalidate the coach's public profile
    const coachProfile = await db.coachProfile.findUnique({
        where: { userId: existing.coachId },
        select: { slug: true },
    });

    if (coachProfile?.slug) {
        revalidatePath(`/coaches/${coachProfile.slug}`);
    }
    revalidatePath("/coaches");

    return testimonial;
}

export async function deleteTestimonial(testimonialId: string) {
    const user = await getCurrentDbUser();

    const existing = await db.testimonial.findUnique({
        where: { id: testimonialId },
    });

    if (!existing || existing.clientId !== user.id) {
        throw new Error("Testimonial not found or unauthorized.");
    }

    await db.testimonial.delete({
        where: { id: testimonialId },
    });

    const coachProfile = await db.coachProfile.findUnique({
        where: { userId: existing.coachId },
        select: { slug: true },
    });

    if (coachProfile?.slug) {
        revalidatePath(`/coaches/${coachProfile.slug}`);
    }
    revalidatePath("/coaches");
}

const reportTestimonialSchema = z.object({
    testimonialId: z.string(),
    reason: z.string().min(5, "Reason must be at least 5 characters").max(500),
});

export async function reportTestimonial(data: z.infer<typeof reportTestimonialSchema>) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Only coaches can report testimonials.");

    const validated = reportTestimonialSchema.parse(data);

    // Verify the testimonial belongs to a profile this coach owns
    const testimonial = await db.testimonial.findUnique({
        where: { id: validated.testimonialId },
    });

    if (!testimonial || testimonial.coachId !== user.id) {
        throw new Error("Testimonial not found or unauthorized.");
    }

    await db.testimonial.update({
        where: { id: validated.testimonialId },
        data: {
            status: "flagged",
            reportReason: validated.reason,
        },
    });

    // Revalidate public profile
    const coachProfile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { slug: true },
    });

    if (coachProfile?.slug) {
        revalidatePath(`/coaches/${coachProfile.slug}`);
    }
    revalidatePath("/coaches");
}
