"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { DEFAULT_INTAKE_FORM_SECTIONS, type IntakeFormSection } from "@/lib/intake-form-defaults";

export async function saveIntakeFormTemplate(input: {
    sections: IntakeFormSection[];
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    // Validate structure
    if (!input.sections.length) throw new Error("At least one section is required.");
    for (const s of input.sections) {
        if (!s.title.trim()) throw new Error("Every section must have a title.");
        if (!s.questions.length) throw new Error(`Section "${s.title}" must have at least one question.`);
        for (const q of s.questions) {
            if (!q.label.trim()) throw new Error("Every question must have a label.");
        }
    }

    await db.intakeFormTemplate.upsert({
        where: { coachId: user.id },
        create: {
            coachId: user.id,
            sections: JSON.parse(JSON.stringify(input.sections)),
        },
        update: {
            sections: JSON.parse(JSON.stringify(input.sections)),
        },
    });

    revalidatePath("/coach/settings");
    return { success: true };
}

export async function getOrCreateDefaultTemplate(coachId: string): Promise<IntakeFormSection[]> {
    const existing = await db.intakeFormTemplate.findUnique({ where: { coachId } });
    if (existing) return existing.sections as unknown as IntakeFormSection[];

    const created = await db.intakeFormTemplate.create({
        data: {
            coachId,
            sections: JSON.parse(JSON.stringify(DEFAULT_INTAKE_FORM_SECTIONS)),
        },
    });
    return created.sections as unknown as IntakeFormSection[];
}
