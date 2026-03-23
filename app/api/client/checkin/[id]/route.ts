import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const updateCheckInSchema = z.object({
  weight: z.number().positive().optional(),
  bodyFatPct: z.number().min(0).max(100).optional(),
  dietCompliance: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(5000).optional(),
  customResponses: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;

    const existing = await db.checkIn.findUnique({
      where: { id },
      select: { id: true, clientId: true, status: true, deletedAt: true },
    });

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    }
    if (existing.clientId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status === "REVIEWED") {
      return NextResponse.json(
        { error: "Cannot update a reviewed check-in" },
        { status: 422 }
      );
    }

    const body = await req.json();
    const parsed = updateCheckInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { weight, bodyFatPct, dietCompliance, energyLevel, notes, customResponses } = parsed.data;

    const updated = await db.checkIn.update({
      where: { id },
      data: {
        ...(weight !== undefined && { weight }),
        ...(bodyFatPct !== undefined && { bodyFatPct }),
        ...(dietCompliance !== undefined && { dietCompliance }),
        ...(energyLevel !== undefined && { energyLevel }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(customResponses !== undefined && {
          customResponses: toJsonValue(customResponses),
        }),
      },
      select: { id: true, status: true, weekOf: true },
    });

    return NextResponse.json({ checkIn: { id: updated.id, status: updated.status, weekOf: updated.weekOf.toISOString() } });
  } catch (err) {
    console.error("[PUT /api/client/checkin/[id]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
