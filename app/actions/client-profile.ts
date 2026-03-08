"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const clientProfileSchema = z.object({
    firstName: z.string().min(1, "First name is required").max(50),
    lastName: z.string().max(50).optional().nullable(),
    clientBio: z.string().max(300, "Bio max 300 characters").optional().nullable(),
    fitnessGoal: z.string().max(100, "Goal max 100 characters").optional().nullable(),
});

export async function updateClientProfile(input: z.infer<typeof clientProfileSchema>) {
    const user = await getCurrentDbUser();

    const parsed = clientProfileSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
    }

    await db.user.update({
        where: { id: user.id },
        data: {
            firstName: parsed.data.firstName,
            lastName: parsed.data.lastName ?? null,
            clientBio: parsed.data.clientBio ?? null,
            fitnessGoal: parsed.data.fitnessGoal ?? null,
        },
    });

    revalidatePath("/client/profile");
    revalidatePath("/client");
    return { success: true };
}
