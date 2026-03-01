import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getClientCheckInsLight } from "@/lib/queries/check-ins";
import { db } from "@/lib/db";
import { normalizeToMonday, getLocalDate } from "@/lib/utils/date";
import { createCheckInSchema } from "@/lib/validations/check-in";

export async function GET() {
    try {
        const user = await getCurrentDbUser();
        const checkIns = await getClientCheckInsLight(user.id);
        return NextResponse.json({ checkIns });
    } catch {
        return NextResponse.json(
            { error: "Not authenticated" },
            { status: 401 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentDbUser();
        if (user.activeRole !== "CLIENT") {
            return NextResponse.json(
                { error: "Only clients can submit check-ins" },
                { status: 403 }
            );
        }

        const coachAssignment = await db.coachClient.findFirst({
            where: { clientId: user.id },
        });
        if (!coachAssignment) {
            return NextResponse.json(
                { error: "Connect to a coach before submitting check-ins" },
                { status: 400 }
            );
        }

        const body = await req.json();
        const parsed = createCheckInSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.flatten().fieldErrors },
                { status: 400 }
            );
        }

        const {
            weight,
            dietCompliance,
            energyLevel,
            notes,
            photoPaths,
            overwriteToday,
            templateId,
            customResponses,
        } = parsed.data;

        const now = new Date();
        const weekDate = normalizeToMonday(now);
        const tz = user.timezone || "America/Los_Angeles";
        const localDate = getLocalDate(now, tz);

        // Check for same-day conflict
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        const existing = await db.checkIn.findFirst({
            where: {
                clientId: user.id,
                submittedAt: { gte: todayStart, lte: todayEnd },
                deletedAt: null,
            },
            select: { id: true, submittedAt: true },
        });

        if (existing && !overwriteToday) {
            return NextResponse.json(
                {
                    conflict: {
                        existing: {
                            id: existing.id,
                            submittedAt: existing.submittedAt.toISOString(),
                        },
                    },
                },
                { status: 409 }
            );
        }

        // If overwriting, soft-delete old check-in
        if (existing && overwriteToday) {
            await db.checkIn.update({
                where: { id: existing.id },
                data: { deletedAt: now },
            });
        }

        const checkIn = await db.checkIn.create({
            data: {
                clientId: user.id,
                weekOf: weekDate,
                isPrimary: true,
                submittedAt: now,
                localDate,
                timezone: tz,
                weight,
                dietCompliance:
                    typeof dietCompliance === "number" ? dietCompliance : null,
                energyLevel:
                    typeof energyLevel === "number" ? energyLevel : null,
                notes: notes || null,
                templateId: templateId || null,
                customResponses: customResponses
                    ? (customResponses as Record<string, string>)
                    : undefined,
                photos: {
                    create: (photoPaths ?? []).map(
                        (path: string, i: number) => ({
                            storagePath: path,
                            sortOrder: i,
                        })
                    ),
                },
            },
        });

        return NextResponse.json(
            {
                checkInId: checkIn.id,
                overwritten: !!existing && !!overwriteToday,
            },
            { status: 201 }
        );
    } catch (err) {
        console.error("[mobile/check-ins] POST error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const user = await getCurrentDbUser();
        if (user.activeRole !== "CLIENT") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { checkInId } = await req.json();
        if (!checkInId) {
            return NextResponse.json(
                { error: "Missing checkInId" },
                { status: 400 }
            );
        }

        const checkIn = await db.checkIn.findUnique({
            where: { id: checkInId },
            select: { clientId: true, deletedAt: true },
        });
        if (!checkIn || checkIn.clientId !== user.id) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (checkIn.deletedAt) {
            return NextResponse.json(
                { error: "Already deleted" },
                { status: 400 }
            );
        }

        await db.checkIn.update({
            where: { id: checkInId },
            data: { deletedAt: new Date() },
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}
