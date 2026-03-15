import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import { LeadActions } from "./lead-actions";

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

    const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
        PENDING:        { label: "New",           color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
        CONTACTED:      { label: "Contacted",     color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20" },
        CALL_SCHEDULED: { label: "Call Scheduled",color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
        ACCEPTED:       { label: "Accepted ✓",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        APPROVED:       { label: "Accepted ✓",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
        DECLINED:       { label: "Declined",      color: "text-zinc-500",    bg: "bg-zinc-800 border-zinc-700" },
        REJECTED:       { label: "Declined",      color: "text-zinc-500",    bg: "bg-zinc-800 border-zinc-700" },
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

            {/* Header */}
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6">
                <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-800 text-xl font-bold text-zinc-200">
                        {lead.prospectName[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-zinc-100">{lead.prospectName}</h1>
                        <a href={`tel:${lead.prospectEmail.replace(/\s/g, "")}`} className="mt-0.5 text-sm text-blue-400 hover:underline">
                            📞 {lead.prospectEmail}
                        </a>
                        <p className="mt-1 text-xs text-zinc-600">
                            Submitted {new Date(lead.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                    </div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${meta.color} ${meta.bg}`}>
                    {meta.label}
                </span>
            </div>

            {/* Intake answers */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6 space-y-5">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Intake Answers</h2>
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
                    <p className="text-sm text-zinc-600">No intake answers recorded.</p>
                )}
            </div>

            {/* Consultation */}
            {lead.consultationMeeting && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-3">
                    <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Consultation</h2>
                    {lead.consultationMeeting.scheduledTime && (
                        <p className="text-sm text-zinc-300">
                            📅 {new Date(lead.consultationMeeting.scheduledTime).toLocaleString("en-US", {
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
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6 space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Actions</h2>
                <LeadActions
                    requestId={lead.id}
                    status={lead.status}
                    existingMeeting={lead.consultationMeeting ? {
                        meetingLink: lead.consultationMeeting.meetingLink,
                        scheduledTime: lead.consultationMeeting.scheduledTime,
                        notes: lead.consultationMeeting.notes,
                    } : null}
                />
            </div>
        </div>
    );
}
