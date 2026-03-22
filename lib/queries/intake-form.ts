import { db } from "@/lib/db";

/**
 * Get a coach's intake form template.
 */
export async function getIntakeFormTemplate(coachId: string) {
    return db.intakeFormTemplate.findUnique({
        where: { coachId },
    });
}
