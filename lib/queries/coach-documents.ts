import { db } from "@/lib/db";

export async function getCoachDocuments(coachId: string) {
    return db.coachDocument.findMany({
        where: { coachId },
        orderBy: { sortOrder: "asc" },
    });
}
