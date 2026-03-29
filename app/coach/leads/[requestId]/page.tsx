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

    const lead = await db.coachingRequest.findUnique({
        where: { id: requestId },
        include: { consultationMeeting: true },
    });

    if (!lead || lead.coachProfileId !== profile.id) notFound();

    const answers = lead.intakeAnswers as Record<string, string>;

    // Fetch active documents for this coach (for the intake packet UI)
    const activeDocuments = await getCoachDocuments(user.id).then(docs => docs.filter(d => d.isActive).map(d => ({ id: d.id, title: d.title, type: d.type })));

    // Fetch intake packet sent date if it exists
    const intakePacket = await db.intakePacket.findUnique({
        where: { coachingRequestId: requestId },
        select: { sentAt: true },
    });

    const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
        PENDING:        { label: "New",           color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
        CONTACTED:      { label: "Contacted",     color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20" },
        CALL_SCHEDULED: { label: "Call Scheduled",color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
        ACCEPTED:       { label: "Accepted ✓",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        APPROVED:       { label: "Accepted ✓",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        DECLINED:       { label: "Inactive",      color: "text-zinc-500",    bg: "bg-zinc-800 border-zinc-700" },
        REJECTED:       { label: "Inactive",      color: "text-zinc-500",    bg: "bg-zinc-800 border-zinc-700" },
        WAITLISTED:     { label: "Waitlisted",    color: "text-zinc-400",    bg: "bg-zinc-800 border-zinc-700" },
    };
    const meta = statusMeta[lead.status] ?? statusMeta.PENDING;

    return (
        <div className="mx-auto max-w-2xl space-y-8">
            {/* Back */}
            <Link href="/coach/leads" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                All Leads
            </Link>

            {/* Pipeline */}
            <div className="sf-glass-card p-4">
                <PipelineBar currentStage={lead.consultationStage} />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between gap-4 sf-glass-card p-6">
                <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-xl font-bold text-zinc-200">
                        {lead.prospectName[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-zinc-100">{lead.prospectName}</h1>
                        <a href={`tel:${(lead.prospectPhone ?? lead.prospectEmail).replace(/\s/g, "")}`} className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-blue-400 hover:underline">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.35 2 2 0 0 1 3.68 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.66a16 16 0 0 0 6 6l1.02-1.02a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            {lead.prospectPhone ?? lead.prospectEmail}
                        </a>
                        {lead.prospectEmailAddr && (
                            <a href={`mailto:${lead.prospectEmailAddr}`} className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-blue-400 hover:underline">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                {lead.prospectEmailAddr}
                            </a>
                        )}
                        <p className="mt-1 text-xs text-zinc-500">
                            Submitted {new Date(lead.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                    </div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${meta.color} ${meta.bg}`}>
                    {meta.label}
                </span>
            </div>

            {/* Intake answers */}
            <div className="sf-glass-card p-6 space-y-5">
                <h2 className="sf-section-label">Intake Answers</h2>
                {answers.goals && (
                    <div>
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Goals</p>
                        <p className="text-sm text-zinc-300 leading-relaxed">{answers.goals}</p>
                    </div>
                )}
                {answers.experience && (
                    <div>
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Experience</p>
                        <p className="text-sm text-zinc-300 leading-relaxed">{answers.experience}</p>
                    </div>
                )}
                {answers.injuries && (
                    <div>
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Injuries / Limitations</p>
                        <p className="text-sm text-zinc-300 leading-relaxed">{answers.injuries}</p>
                    </div>
                )}
                {!answers.goals && !answers.experience && !answers.injuries && (
                    <p className="text-sm text-zinc-400">No intake answers recorded.</p>
                )}
            </div>

            {/* Consultation */}
            {lead.consultationMeeting && (
                <div className="sf-glass-card p-6 space-y-3" style={{ borderColor: "rgba(245, 158, 11, 0.20)" }}>
                    <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Consultation</h2>
                    {lead.consultationMeeting.scheduledTime && (
                        <p className="inline-flex items-center gap-1.5 text-sm text-zinc-300">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                            {new Date(lead.consultationMeeting.scheduledTime).toLocaleString("en-US", {
                                month: "short", day: "numeric", year: "numeric",
                                hour: "numeric", minute: "2-digit",
                            })}
                        </p>
                    )}
                    {lead.consultationMeeting.meetingLink && (
                        <a href={lead.consultationMeeting.meetingLink} target="_blank" rel="noopener noreferrer"
                           className="text-sm text-blue-400 hover:underline break-all">
                            {lead.consultationMeeting.meetingLink}
                        </a>
                    )}
                    {lead.consultationMeeting.notes && (
                        <p className="text-sm text-zinc-400">{lead.consultationMeeting.notes}</p>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="sf-glass-card p-6 space-y-4">
                <h2 className="sf-section-label">Actions</h2>
                <LeadActions
                    requestId={lead.id}
                    status={lead.status}
                    prospectId={lead.prospectId}
                    prospectName={lead.prospectName}
                    consultationStage={lead.consultationStage}
                    consultationDate={(lead.consultationDate ?? lead.consultationMeeting?.scheduledTime)?.toISOString() ?? null}
                    formsSignedAt={lead.formsSignedAt?.toISOString() ?? null}
                    prospectEmailAddr={lead.prospectEmailAddr ?? null}
                    existingMeeting={lead.consultationMeeting ? {
                        meetingLink: lead.consultationMeeting.meetingLink,
                        scheduledTime: lead.consultationMeeting.scheduledTime,
                        notes: lead.consultationMeeting.notes,
                    } : null}
                    activeDocuments={activeDocuments}
                    intakePacketSentAt={intakePacket?.sentAt?.toISOString() ?? null}
                />
            </div>
        </div>
    );
}
