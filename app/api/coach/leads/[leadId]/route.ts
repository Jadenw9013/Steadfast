import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { COACH_SETTABLE_STAGES } from "@/lib/leads/activate-lead";

type Params = { params: Promise<{ leadId: string }> };

// ── Helper: verify coach owns this lead ──────────────────────────────────────

async function verifyCoachOwnsLead(userId: string, leadId: string) {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT cr."id"
    FROM "CoachingRequest" cr
    JOIN "CoachProfile" cp ON cp."id" = cr."coachProfileId"
    WHERE cr."id" = ${leadId} AND cp."userId" = ${userId}
    LIMIT 1
  `;
  return rows.length > 0;
}

// ── GET — full lead detail ────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;

    // Single raw query with LEFT JOINs for related data
    const rows = await db.$queryRaw<Array<{
      id: string;
      prospectName: string;
      prospectEmail: string;
      prospectEmailAddr: string | null;
      prospectPhone: string | null;
      status: string;
      consultationStage: string;
      source: string;
      sourceDetail: string | null;
      coachNotes: string | null;
      intakeAnswers: unknown;
      createdAt: Date;
      updatedAt: Date;
      formsSentAt: Date | null;
      formsSignedAt: Date | null;
      prospectId: string | null;
      coachProfileId: string;
      ip_id: string | null;
      ip_sentAt: Date | null;
      ip_submittedAt: Date | null;
      ip_formAnswers: unknown;
      fs_status: string | null;
      fs_completedAt: Date | null;
      sig_signedAt: Date | null;
    }>>`
      SELECT
        cr."id", cr."prospectName", cr."prospectEmail", cr."prospectEmailAddr",
        cr."prospectPhone", cr."status"::text, cr."consultationStage"::text,
        cr."source"::text, cr."sourceDetail", cr."coachNotes",
        cr."intakeAnswers", cr."createdAt", cr."updatedAt",
        cr."formsSentAt", cr."formsSignedAt", cr."prospectId", cr."coachProfileId",
        ip."id" as "ip_id", ip."sentAt" as "ip_sentAt",
        ip."submittedAt" as "ip_submittedAt", ip."formAnswers" as "ip_formAnswers",
        fs."status"::text as "fs_status", fs."completedAt" as "fs_completedAt",
        sig."signedAt" as "sig_signedAt"
      FROM "CoachingRequest" cr
      JOIN "CoachProfile" cp ON cp."id" = cr."coachProfileId" AND cp."userId" = ${user.id}
      LEFT JOIN "IntakePacket" ip ON ip."coachingRequestId" = cr."id"
      LEFT JOIN "ClientFormSubmission" fs ON fs."coachingRequestId" = cr."id"
      LEFT JOIN "ClientFormSignature" sig ON sig."coachingRequestId" = cr."id"
      WHERE cr."id" = ${leadId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const r = rows[0];
    const toISO = (d: Date | null) => d ? new Date(d).toISOString() : null;

    const intakeStatus = r.ip_id ? (r.ip_submittedAt ? "SUBMITTED" : "SENT") : "NOT_SENT";
    const documentsStatus = r.formsSignedAt ? "SIGNED" : r.formsSentAt ? "SENT" : "NOT_SENT";

    return NextResponse.json({
      lead: {
        id: r.id,
        prospectName: r.prospectName,
        prospectEmail: r.prospectEmail,
        prospectEmailAddr: r.prospectEmailAddr,
        prospectPhone: r.prospectPhone,
        status: r.status,
        consultationStage: r.consultationStage,
        source: r.source,
        sourceDetail: r.sourceDetail,
        coachNotes: r.coachNotes,
        intakeAnswers: r.intakeAnswers,
        createdAt: toISO(r.createdAt),
        updatedAt: toISO(r.updatedAt),
        formsSentAt: toISO(r.formsSentAt),
        formsSignedAt: toISO(r.formsSignedAt),
        prospectId: r.prospectId,
        intakeStatus,
        documentsStatus,
        intakePacket: r.ip_id
          ? { id: r.ip_id, sentAt: toISO(r.ip_sentAt), submittedAt: toISO(r.ip_submittedAt) }
          : null,
        formSubmission: r.fs_status
          ? { status: r.fs_status, completedAt: toISO(r.fs_completedAt) }
          : null,
        signature: r.sig_signedAt ? { signedAt: toISO(r.sig_signedAt) } : null,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/coach/leads/[leadId]]", msg);
    return NextResponse.json({ error: `Internal server error: ${msg}` }, { status: 500 });
  }
}

// ── PATCH — update coach notes, intake answers, and/or stage ──────────────────

const patchSchema = z.object({
  coachNotes: z.string().max(5000).optional(),
  intakeAnswers: z.record(z.string(), z.unknown()).optional(),
  // T-978: was z.string() — an unvalidated free-form string cast to the enum
  // in raw SQL below, which let {"consultationStage":"ACTIVE"} flip any
  // owned lead ACTIVE with no transition check, no relationship and no
  // invite. Narrowed to the same ACTIVE-excluding enum PUT already used.
  consultationStage: z.enum(COACH_SETTABLE_STAGES).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;
    if (!(await verifyCoachOwnsLead(user.id, leadId))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 422 });
    }

    // Build dynamic SET clauses
    const sets: string[] = ['"updatedAt" = NOW()'];
    const values: unknown[] = [];

    if (parsed.data.coachNotes !== undefined) {
      values.push(parsed.data.coachNotes);
      sets.push(`"coachNotes" = $${values.length + 1}`);
    }
    if (parsed.data.intakeAnswers !== undefined) {
      values.push(JSON.stringify(parsed.data.intakeAnswers));
      sets.push(`"intakeAnswers" = $${values.length + 1}::jsonb`);
    }
    if (parsed.data.consultationStage !== undefined) {
      values.push(parsed.data.consultationStage);
      sets.push(`"consultationStage" = $${values.length + 1}::"ConsultationStage"`);
    }

    // Use tagged template for parameterized raw query
    if (parsed.data.coachNotes !== undefined && parsed.data.intakeAnswers === undefined && parsed.data.consultationStage === undefined) {
      await db.$executeRaw`
        UPDATE "CoachingRequest" SET "coachNotes" = ${parsed.data.coachNotes}, "updatedAt" = NOW() WHERE "id" = ${leadId}
      `;
    } else if (parsed.data.intakeAnswers !== undefined && parsed.data.coachNotes === undefined && parsed.data.consultationStage === undefined) {
      const json = JSON.stringify(parsed.data.intakeAnswers);
      await db.$executeRaw`
        UPDATE "CoachingRequest" SET "intakeAnswers" = ${json}::jsonb, "updatedAt" = NOW() WHERE "id" = ${leadId}
      `;
    } else if (parsed.data.consultationStage !== undefined && parsed.data.coachNotes === undefined && parsed.data.intakeAnswers === undefined) {
      await db.$executeRaw`
        UPDATE "CoachingRequest" SET "consultationStage" = ${parsed.data.consultationStage}::"ConsultationStage", "updatedAt" = NOW() WHERE "id" = ${leadId}
      `;
    } else {
      // Multiple fields — update them individually
      if (parsed.data.coachNotes !== undefined) {
        await db.$executeRaw`UPDATE "CoachingRequest" SET "coachNotes" = ${parsed.data.coachNotes} WHERE "id" = ${leadId}`;
      }
      if (parsed.data.intakeAnswers !== undefined) {
        const json = JSON.stringify(parsed.data.intakeAnswers);
        await db.$executeRaw`UPDATE "CoachingRequest" SET "intakeAnswers" = ${json}::jsonb WHERE "id" = ${leadId}`;
      }
      if (parsed.data.consultationStage !== undefined) {
        await db.$executeRaw`UPDATE "CoachingRequest" SET "consultationStage" = ${parsed.data.consultationStage}::"ConsultationStage" WHERE "id" = ${leadId}`;
      }
      await db.$executeRaw`UPDATE "CoachingRequest" SET "updatedAt" = NOW() WHERE "id" = ${leadId}`;
    }

    // Fetch updated record
    const rows = await db.$queryRaw<Array<{
      id: string; coachNotes: string | null; intakeAnswers: unknown; consultationStage: string; updatedAt: Date;
    }>>`
      SELECT "id", "coachNotes", "intakeAnswers", "consultationStage"::text, "updatedAt"
      FROM "CoachingRequest" WHERE "id" = ${leadId} LIMIT 1
    `;

    const updated = rows[0];
    return NextResponse.json({
      lead: {
        id: updated.id,
        coachNotes: updated.coachNotes,
        intakeAnswers: updated.intakeAnswers,
        consultationStage: updated.consultationStage,
        updatedAt: new Date(updated.updatedAt).toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/coach/leads/[leadId]]", msg);
    return NextResponse.json({ error: `Internal server error: ${msg}` }, { status: 500 });
  }
}

// ── PUT — update lead status and/or consultation stage ────────────────────────
// ACTIVE excluded from both — this route was already the precedent
// COACH_SETTABLE_STAGES generalises (T-978).

const updateLeadSchema = z.object({
  status: z.enum(["PENDING", "CONTACTED", "CALL_SCHEDULED", "ACCEPTED", "DECLINED", "WAITLISTED"]).optional(),
  stage: z.enum(COACH_SETTABLE_STAGES).optional(),
  consultationStage: z.enum(COACH_SETTABLE_STAGES).optional(),
});

export async function PUT(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;
    if (!(await verifyCoachOwnsLead(user.id, leadId))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { status, stage, consultationStage } = parsed.data;
    const newStage = stage ?? consultationStage;

    if (status !== undefined) {
      await db.$executeRaw`
        UPDATE "CoachingRequest" SET "status" = ${status}::"RequestStatus", "updatedAt" = NOW() WHERE "id" = ${leadId}
      `;
    }
    if (newStage !== undefined) {
      await db.$executeRaw`
        UPDATE "CoachingRequest" SET "consultationStage" = ${newStage}::"ConsultationStage", "updatedAt" = NOW() WHERE "id" = ${leadId}
      `;
    }

    const rows = await db.$queryRaw<Array<{
      id: string; status: string; consultationStage: string; updatedAt: Date;
    }>>`
      SELECT "id", "status"::text, "consultationStage"::text, "updatedAt"
      FROM "CoachingRequest" WHERE "id" = ${leadId} LIMIT 1
    `;

    const updated = rows[0];
    return NextResponse.json({
      lead: {
        id: updated.id,
        status: updated.status,
        consultationStage: updated.consultationStage,
        updatedAt: new Date(updated.updatedAt).toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[PUT /api/coach/leads/[leadId]]", msg);
    return NextResponse.json({ error: `Internal server error: ${msg}` }, { status: 500 });
  }
}
