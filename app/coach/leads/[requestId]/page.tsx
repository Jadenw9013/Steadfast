import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import { LeadActions } from "./lead-actions";
import { PipelineBar } from "./pipeline-bar";
import { getCoachDocuments } from "@/lib/queries/coach-documents";

export const metadata: Metadata = { title: "Lead Profile | Steadfast" };

export default async function LeadProfilePage({ params }: { params: Promise<{ requestId: string }> }) {
    const { requestId } = await params;
    const user = await getCurrentDbUser();
    if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
    });
    if (!profile) notFound();

    // Standard Prisma queries — adapter-pg has been removed, so Json columns are safe
    const lead = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: {
            id: true, coachProfileId: true, prospectName: true, prospectEmail: true,
            prospectPhone: true, prospectEmailAddr: true, prospectId: true,
            intakeAnswers: true, status: true, consultationStage: true,
            consultationDate: true, formsSignedAt: true, source: true,
            createdAt: true, updatedAt: true,
        },
    });

    if (!lead || lead.coachProfileId !== profile.id) notFound();

    const consultationMeeting = await db.consultationMeeting.findUnique({
        where: { requestId },
        select: { meetingLink: true, scheduledTime: true, notes: true },
    }).catch(() => null);

    // Parse intakeAnswers (Prisma returns it as JsonValue)
    let answers: Record<string, string> = {};
    try {
        answers = (lead.intakeAnswers ?? {}) as Record<string, string>;
    } catch { answers = {}; }

    // Fetch active documents for this coach
    const activeDocuments = await getCoachDocuments(user.id)
        .then(docs => docs.filter(d => d.isActive).map(d => ({ id: d.id, title: d.title, type: d.type })))
        .catch(() => [] as { id: string; title: string; type: string }[]);

    // Fetch intake packet sent date
    const intakePacket = await db.intakePacket.findUnique({
        where: { coachingRequestId: requestId },
        select: { sentAt: true },
    }).catch(() => null);

    // ── Status badge colors ──────────────────────────────────────────────────
    const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
        PENDING:   { label: "Pending",  color: "text-blue-300",    bg: "bg-blue-500/15 border-blue-500/30" },
        APPROVED:  { label: "Approved", color: "text-emerald-300", bg: "bg-emerald-500/15 border-emerald-500/30" },
        ACCEPTED:  { label: "Approved", color: "text-emerald-300", bg: "bg-emerald-500/15 border-emerald-500/30" },
        CONTACTED: { label: "Contacted", color: "text-amber-300",  bg: "bg-amber-500/15 border-amber-500/30" },
        DECLINED:  { label: "Inactive", color: "text-zinc-400",    bg: "bg-zinc-700/50 border-zinc-600" },
        REJECTED:  { label: "Inactive", color: "text-zinc-400",    bg: "bg-zinc-700/50 border-zinc-600" },
    };
    const meta = statusMeta[lead.status] ?? statusMeta.PENDING;

    // ── Effective stage helper ────────────────────────────────────────────────
    const effectiveStage = lead.consultationStage ?? "PENDING";
    const isDeclined = effectiveStage === "DECLINED" || lead.status === "DECLINED" || lead.status === "REJECTED";
    const hasIntakeAnswers = !!(answers.goals || answers.experience || answers.injuries);

    // Stage ring gradient colors (matching iOS)
    function stageRingColors(stage: string): [string, string] {
        switch (stage) {
            case "PENDING":                return ["#3B82F6", "#6366F1"];
            case "CONSULTATION_SCHEDULED":
            case "CONSULTATION_DONE":      return ["#F59E0B", "#EF4444"];
            case "INTAKE_SENT":
            case "INTAKE_SUBMITTED":       return ["#10B981", "#3B82F6"];
            case "FORMS_SENT":
            case "FORMS_SIGNED":           return ["#10B981", "#3B82F6"];
            case "ACTIVE":                 return ["#10B981", "#34D399"];
            default:                       return ["#3B82F6", "#6366F1"];
        }
    }

    const [c1, c2] = stageRingColors(effectiveStage);

    return (
        <div className="mx-auto max-w-2xl space-y-5 pb-12">
            {/* Back */}
            <Link href="/coach/leads" className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                All Leads
            </Link>

            {/* ── 1. Hero Header ─────────────────────────────────────────────── */}
            <div className="sf-glass-card p-6">
                <div className="flex items-start gap-4">
                    {/* Avatar with gradient ring */}
                    <div className="relative shrink-0">
                        <div
                            className="flex h-16 w-16 items-center justify-center rounded-full"
                            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                        >
                            <div className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#0e1117]">
                                <span className="text-xl font-bold text-zinc-100">
                                    {lead.prospectName[0]?.toUpperCase() ?? "?"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 space-y-2">
                        <h1 className="text-xl font-bold tracking-tight text-white">{lead.prospectName}</h1>

                        {/* Phone — tappable row */}
                        {(lead.prospectPhone || lead.prospectEmail) && (
                            <a
                                href={`tel:${(lead.prospectPhone ?? lead.prospectEmail).replace(/\s/g, "")}`}
                                className="flex items-center gap-2 group"
                            >
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.35 2 2 0 0 1 3.68 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.66a16 16 0 0 0 6 6l1.02-1.02a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                </span>
                                <span className="text-sm font-medium text-blue-400 group-hover:underline truncate">{lead.prospectPhone ?? lead.prospectEmail}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                            </a>
                        )}

                        {/* Email row */}
                        {lead.prospectEmailAddr && (
                            <a
                                href={`mailto:${lead.prospectEmailAddr}`}
                                className="flex items-center gap-2 group"
                            >
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/15">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                </span>
                                <span className="text-sm font-medium text-blue-400 group-hover:underline truncate">{lead.prospectEmailAddr}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                            </a>
                        )}

                        {/* Source + date */}
                        <div className="flex items-center gap-2 pt-0.5">
                            {lead.source && (
                                <span className="text-xs font-medium text-zinc-400">{lead.source.charAt(0).toUpperCase() + lead.source.slice(1)}</span>
                            )}
                            {lead.source && <span className="text-zinc-600">·</span>}
                            <span className="text-xs font-medium text-zinc-400">
                                Added {new Date(lead.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                        </div>
                    </div>

                    {/* Status badge */}
                    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${meta.color} ${meta.bg}`}>
                        {meta.label}
                    </span>
                </div>
            </div>

            {/* ── 2. Pipeline (4-stage) ──────────────────────────────────────── */}
            {!isDeclined && (
                <div className="sf-glass-card p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Pipeline</span>
                    </div>
                    <PipelineBar currentStage={effectiveStage} />
                </div>
            )}

            {/* ── 3. Prospect Info ────────────────────────────────────────────── */}
            <div className="sf-glass-card p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Prospect Info</span>
                </div>

                {/* Intake answers */}
                {answers.goals && (
                    <div className="flex gap-4">
                        <span className="shrink-0 w-24 text-sm font-semibold text-zinc-400">Goals</span>
                        <p className="text-sm text-zinc-200 leading-relaxed">{answers.goals}</p>
                    </div>
                )}
                {answers.goals && (answers.experience || answers.injuries) && <hr className="border-white/[0.08]" />}

                {answers.experience && (
                    <div className="flex gap-4">
                        <span className="shrink-0 w-24 text-sm font-semibold text-zinc-400">Experience</span>
                        <p className="text-sm text-zinc-200 leading-relaxed">{answers.experience}</p>
                    </div>
                )}
                {answers.experience && answers.injuries && <hr className="border-white/[0.08]" />}

                {answers.injuries && (
                    <div className="flex gap-4">
                        <span className="shrink-0 w-24 text-sm font-semibold text-zinc-400">Injuries</span>
                        <p className="text-sm text-zinc-200 leading-relaxed">{answers.injuries}</p>
                    </div>
                )}

                {!hasIntakeAnswers && (
                    <p className="text-sm text-zinc-400">No intake answers recorded.</p>
                )}
            </div>

            {/* ── 4. Intake Section (conditional) ─────────────────────────────── */}
            {["CONSULTATION_SCHEDULED", "CONSULTATION_DONE", "INTAKE_SENT", "INTAKE_SUBMITTED", "ACTIVE"].includes(effectiveStage) && (
                <div className="sf-glass-card p-6 space-y-3">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Intake</span>
                    </div>

                    {(effectiveStage === "INTAKE_SUBMITTED" || effectiveStage === "ACTIVE") ? (
                        <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-1.5 text-sm font-semibold text-emerald-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                Intake Finalized
                            </span>
                            <Link href={`/coach/leads/${requestId}/review`} className="text-sm font-semibold text-blue-400 hover:underline">
                                View
                            </Link>
                        </div>
                    ) : hasIntakeAnswers ? (
                        <>
                            <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-3.5 py-1.5 text-sm font-semibold text-blue-300">
                                    Client Pre-filled
                                </span>
                                <Link href={`/coach/leads/${requestId}/review`} className="text-sm font-semibold text-blue-400 hover:underline">
                                    Open &amp; Edit
                                </Link>
                            </div>
                            <p className="text-sm text-zinc-400">Review and finalize during your consultation meeting.</p>
                        </>
                    ) : (
                        <div className="space-y-2">
                            <Link href={`/coach/leads/${requestId}/review`} className="flex items-center gap-2 text-sm font-semibold text-blue-400 hover:underline">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
                                Open Intake Form
                            </Link>
                            <p className="text-sm text-zinc-400">Fill out intake during your consultation meeting.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ── 5. Actions ─────────────────────────────────────────────────── */}
            <div className="sf-glass-card p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Actions</span>
                </div>
                <LeadActions
                    requestId={lead.id}
                    status={lead.status}
                    prospectId={lead.prospectId}
                    prospectName={lead.prospectName}
                    consultationStage={effectiveStage}
                    consultationDate={lead.consultationDate?.toISOString() ?? consultationMeeting?.scheduledTime?.toISOString() ?? null}
                    formsSignedAt={lead.formsSignedAt?.toISOString() ?? null}
                    prospectEmailAddr={lead.prospectEmailAddr ?? null}
                    existingMeeting={consultationMeeting ? {
                        meetingLink: consultationMeeting.meetingLink,
                        scheduledTime: consultationMeeting.scheduledTime?.toISOString() ?? null,
                        notes: consultationMeeting.notes,
                    } : null}
                    activeDocuments={activeDocuments}
                    intakePacketSentAt={intakePacket?.sentAt?.toISOString() ?? null}
                    coachNotes={null}
                />
            </div>
        </div>
    );
}
