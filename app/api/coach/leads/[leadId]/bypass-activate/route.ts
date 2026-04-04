import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

type Params = { params: Promise<{ leadId: string }> };

// ── POST — bypass pipeline and activate client directly ──────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;

    // 1. Get coach profile
    const profile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!profile) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

    // 2. Fetch the lead (read-only — safe with adapter-pg)
    const request = await db.coachingRequest.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        coachProfileId: true,
        consultationStage: true,
        prospectName: true,
        prospectEmail: true,
        prospectPhone: true,
        prospectEmailAddr: true,
      },
    });

    if (!request || request.coachProfileId !== profile.id) {
      return NextResponse.json({ success: false, message: "Lead not found" }, { status: 404 });
    }

    if (request.consultationStage === "ACTIVE") {
      return NextResponse.json({ success: false, message: "This lead is already active." }, { status: 409 });
    }
    if (request.consultationStage === "DECLINED") {
      return NextResponse.json({ success: false, message: "This lead was declined." }, { status: 409 });
    }

    // 3. Find the prospect's User account
    const email = request.prospectEmailAddr ?? null;
    const phone = (request.prospectPhone ?? request.prospectEmail ?? "").replace(/\D/g, "");
    let existingUser = email
      ? await db.user.findUnique({ where: { email: email.toLowerCase() } })
      : null;
    if (!existingUser && phone.length >= 7) {
      existingUser = await db.user.findFirst({
        where: { phoneNumber: { contains: phone.slice(-10) } },
      });
    }

    if (!existingUser) {
      return NextResponse.json({
        success: false,
        message: "This prospect hasn't created a Steadfast account yet. Send them an invite first.",
      }, { status: 422 });
    }

    // 4. Create CoachClient link (idempotent)
    const existingConn = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId: existingUser.id } },
    });
    if (!existingConn) {
      await db.coachClient.create({
        data: { coachId: user.id, clientId: existingUser.id, coachNotes: "Activated via pipeline bypass." },
      });
    }

    // 5. Update the coaching request to ACTIVE
    await db.coachingRequest.update({
      where: { id: leadId },
      data: {
        consultationStage: "ACTIVE",
        status: "ACCEPTED",
        prospectId: existingUser.id,
      },
    });

    // 6. Send welcome email (fire-and-forget — never blocks)
    try {
      const { sendEmail } = await import("@/lib/email/sendEmail");
      const { coachConnectedEmail } = await import("@/lib/email/templates");
      const emailContent = coachConnectedEmail(
        existingUser.firstName || request.prospectName,
        user.firstName || "Your coach"
      );
      sendEmail({ to: existingUser.email, ...emailContent }).catch(() => {});
    } catch { /* email failure must not block */ }

    // 7. Revalidate cache (non-blocking — may throw in edge contexts)
    try { const { revalidatePath } = await import("next/cache"); revalidatePath("/coach/leads"); } catch {}
    try { const { revalidatePath } = await import("next/cache"); revalidatePath("/coach/dashboard"); } catch {}

    return NextResponse.json({
      success: true,
      message: `${request.prospectName} has been added to your roster.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/coach/leads/[leadId]/bypass-activate]", msg, err);
    return NextResponse.json({ success: false, message: `Internal server error: ${msg}` }, { status: 500 });
  }
}
