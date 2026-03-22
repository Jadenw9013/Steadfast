"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { uploadCoachDocument, deleteCoachDocumentFile } from "@/lib/supabase/document-storage";

export async function saveCoachDocument(input: {
    id?: string;
    title: string;
    type: "TEXT" | "FILE";
    content?: string;
    fileData?: string; // base64
    fileType?: string;
    fileName?: string;
}) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    if (!input.title.trim()) return { error: "Title is required." };

    if (input.id) {
        // Update existing
        const existing = await db.coachDocument.findUnique({ where: { id: input.id } });
        if (!existing || existing.coachId !== user.id) throw new Error("Not found");

        const data: Record<string, unknown> = { title: input.title.trim() };
        if (input.type === "TEXT") data.content = input.content ?? "";
        
        await db.coachDocument.update({ where: { id: input.id }, data });
        revalidatePath("/coach/settings");
        return { success: true, id: input.id };
    }

    // Create new
    const maxOrder = await db.coachDocument.aggregate({
        where: { coachId: user.id },
        _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    if (input.type === "FILE" && input.fileData && input.fileName) {
        const ext = input.fileName.split(".").pop() || "bin";
        const doc = await db.coachDocument.create({
            data: {
                coachId: user.id,
                title: input.title.trim(),
                type: "FILE",
                fileType: input.fileType,
                fileName: input.fileName,
                sortOrder,
            },
        });

        const storagePath = `${user.id}/${doc.id}.${ext}`;
        const buffer = Buffer.from(input.fileData, "base64");
        await uploadCoachDocument(storagePath, buffer, input.fileType || "application/octet-stream");

        await db.coachDocument.update({
            where: { id: doc.id },
            data: { filePath: storagePath },
        });

        revalidatePath("/coach/settings");
        return { success: true, id: doc.id };
    }

    const doc = await db.coachDocument.create({
        data: {
            coachId: user.id,
            title: input.title.trim(),
            type: "TEXT",
            content: input.content ?? "",
            sortOrder,
        },
    });

    revalidatePath("/coach/settings");
    return { success: true, id: doc.id };
}

export async function deleteCoachDocument(id: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const doc = await db.coachDocument.findUnique({ where: { id } });
    if (!doc || doc.coachId !== user.id) throw new Error("Not found");

    if (doc.filePath) {
        try { await deleteCoachDocumentFile(doc.filePath); } catch { /* non-critical */ }
    }

    await db.coachDocument.delete({ where: { id } });
    revalidatePath("/coach/settings");
    return { success: true };
}

export async function toggleDocumentActive(id: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const doc = await db.coachDocument.findUnique({ where: { id } });
    if (!doc || doc.coachId !== user.id) throw new Error("Not found");

    await db.coachDocument.update({
        where: { id },
        data: { isActive: !doc.isActive },
    });

    revalidatePath("/coach/settings");
    return { success: true, isActive: !doc.isActive };
}

export async function updateDocumentOrder(orderedIds: string[]) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    await Promise.all(
        orderedIds.map((id, index) =>
            db.coachDocument.updateMany({
                where: { id, coachId: user.id },
                data: { sortOrder: index },
            })
        )
    );

    revalidatePath("/coach/settings");
    return { success: true };
}
