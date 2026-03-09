import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { renderTrainingProgramPdf } from "@/lib/pdf/training-program-pdf";
import type { TrainingProgramPdfData } from "@/lib/pdf/training-program-pdf";

export const runtime = "nodejs";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ programId: string }> }
) {
    const { programId } = await params;

    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const program = await db.trainingProgram.findUnique({
        where: { id: programId },
        include: {
            client: {
                select: { id: true, firstName: true, lastName: true },
            },
            days: {
                orderBy: { sortOrder: "asc" },
                select: {
                    dayName: true,
                    blocks: {
                        orderBy: { sortOrder: "asc" },
                        select: { type: true, title: true, content: true, sortOrder: true },
                    },
                },
            },
        },
    });

    if (!program) {
        return NextResponse.json({ error: "Training program not found" }, { status: 404 });
    }

    // Authorization: must be the client or their coach
    const isClient = program.clientId === user.id;
    let coachName: string | undefined;
    let coachHeadline: string | undefined;

    if (!isClient) {
        if (!user.isCoach) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const assignment = await db.coachClient.findUnique({
            where: {
                coachId_clientId: { coachId: user.id, clientId: program.clientId },
            },
        });
        if (!assignment) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        coachName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined;
        const coachProfile = await db.coachProfile.findUnique({
            where: { userId: user.id },
            select: { headline: true },
        });
        coachHeadline = coachProfile?.headline ?? undefined;
    } else {
        const assignment = await db.coachClient.findFirst({
            where: { clientId: user.id },
            include: {
                coach: {
                    select: {
                        firstName: true,
                        lastName: true,
                        coachProfile: { select: { headline: true } },
                    },
                },
            },
        });
        if (assignment) {
            coachName =
                `${assignment.coach.firstName ?? ""} ${assignment.coach.lastName ?? ""}`.trim() ||
                undefined;
            coachHeadline = assignment.coach.coachProfile?.headline ?? undefined;
        }
    }

    const clientName =
        `${program.client.firstName ?? ""} ${program.client.lastName ?? ""}`.trim() ||
        "Client";

    const pdfData: TrainingProgramPdfData = {
        clientName,
        coachName,
        coachHeadline,
        weeklyFrequency: program.weeklyFrequency ?? undefined,
        clientNotes: program.clientNotes ?? undefined,
        days: program.days.map((day) => ({
            dayName: day.dayName,
            blocks: day.blocks.map((b) => ({
                type: b.type,
                title: b.title,
                content: b.content,
                sortOrder: b.sortOrder,
            })),
        })),
    };

    const buffer = await renderTrainingProgramPdf(pdfData);

    const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, "-");
    const filename = `training-program_${safeClientName}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
}
