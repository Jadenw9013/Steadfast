import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import Link from "next/link";
import { Metadata } from "next";
import { AddLeadButton } from "@/components/coach/add-lead-button";

export const metadata: Metadata = { title: "Leads | Steadfast" };

type StatusGroup = {
    label: string;
    color: string;
    bg: string;
};

const STATUS_META: Record<string, StatusGroup> = {
    PENDING:       { label: "New",           color: "text-blue-400",    bg: "bg-blue-500/10" },
    CONTACTED:     { label: "Contacted",     color: "text-violet-400",  bg: "bg-violet-500/10" },
    CALL_SCHEDULED:{ label: "Call Scheduled",color: "text-amber-400",   bg: "bg-amber-500/10" },
    ACCEPTED:      { label: "Accepted",      color: "text-emerald-400", bg: "bg-emerald-500/10" },
    APPROVED:      { label: "Accepted",      color: "text-emerald-400", bg: "bg-emerald-500/10" },
    DECLINED:      { label: "Inactive",      color: "text-zinc-500",    bg: "bg-zinc-800" },
    REJECTED:      { label: "Inactive",      color: "text-zinc-500",    bg: "bg-zinc-800" },
    WAITLISTED:    { label: "Waitlisted",    color: "text-zinc-400",    bg: "bg-zinc-800" },
};

const PIPELINE_GROUPS = [
    { key: "PENDING", label: "Pending", stages: ["PENDING"] },
    { key: "IN_CONSULTATION", label: "In Consultation", stages: ["CONSULTATION_SCHEDULED", "CONSULTATION_DONE"] },
    { key: "INTAKE_OUT", label: "Intake Out", stages: ["INTAKE_SENT"] },
    { key: "INTAKE_RECEIVED", label: "Intake Received", stages: ["INTAKE_SUBMITTED"] },
    { key: "FORMS", label: "Forms Out", stages: ["FORMS_SENT"] },
    { key: "READY_TO_ACTIVATE", label: "Ready to Activate", stages: ["FORMS_SIGNED"] },
    { key: "ACTIVE", label: "Active", stages: ["ACTIVE"] },
] as const;

function daysInStage(updatedAt: Date): number {
    return Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
}

function daysAgo(date: Date | null): string {
    if (!date) return "";
    const d = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    if (d === 0) return "Signed today";
    if (d === 1) return "Signed 1 day ago";
    return `Signed ${d} days ago`;
}

const STAGE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    PENDING:                { label: "New",                   color: "text-blue-400",    bg: "bg-blue-500/10" },
    CONSULTATION_SCHEDULED: { label: "Consultation Scheduled",color: "text-amber-400",   bg: "bg-amber-500/10" },
    CONSULTATION_DONE:      { label: "Consultation Done",     color: "text-violet-400",  bg: "bg-violet-500/10" },
    INTAKE_SENT:            { label: "Intake Sent",           color: "text-cyan-400",    bg: "bg-cyan-500/10" },
    INTAKE_SUBMITTED:       { label: "Intake Received",       color: "text-emerald-400", bg: "bg-emerald-500/10" },
    FORMS_SENT:             { label: "Forms Sent",            color: "text-cyan-400",    bg: "bg-cyan-500/10" },
    FORMS_SIGNED:           { label: "Signed",                color: "text-amber-400",   bg: "bg-amber-500/10" },
    ACTIVE:                 { label: "Active",                color: "text-emerald-400", bg: "bg-emerald-500/10" },
    DECLINED:               { label: "Inactive",              color: "text-zinc-500",    bg: "bg-zinc-800" },
};

export default async function CoachLeadsPage() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
    });

    if (!profile) {
        return (
            <div className="space-y-4">
                <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
                <p className="text-sm text-zinc-500">You don&apos;t have a coaching profile yet. <Link href="/coach/marketplace/profile" className="text-blue-400 hover:underline">Set one up →</Link></p>
            </div>
        );
    }

    const requests = await db.coachingRequest.findMany({
        where: { coachProfileId: profile.id },
        orderBy: { createdAt: "desc" },
    });

    const declinedLeads = requests.filter((r) => r.consultationStage === "DECLINED" || r.status === "DECLINED" || r.status === "REJECTED");

    return (
        <div className="space-y-10">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
                    <p className="mt-1 text-sm text-zinc-500">Manage your incoming coaching requests</p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/coach/clients/invite"
                        className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-all hover:bg-zinc-100 active:scale-[0.97]"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                        Invite Client
                    </Link>
                </div>
            </div>

            <AddLeadButton />

            {/* Pipeline groups */}
            {PIPELINE_GROUPS.map((group) => {
                const leads = requests.filter((r) =>
                    (group.stages as readonly string[]).includes(r.consultationStage) &&
                    r.status !== "DECLINED" && r.status !== "REJECTED"
                );

                if (leads.length === 0) return null;

                const isReadyToActivate = group.key === "READY_TO_ACTIVATE";

                return (
                    <section key={group.key}>
                        <h2 className={`mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${isReadyToActivate ? "text-amber-400" : "text-zinc-500"}`}>
                            {group.label}
                            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${isReadyToActivate ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>{leads.length}</span>
                        </h2>
                        <div className="space-y-2">
                            {leads.map((r) => {
                                const stageMeta = STAGE_LABELS[r.consultationStage] ?? STAGE_LABELS.PENDING;
                                const statusMeta = STATUS_META[r.status] ?? STATUS_META.PENDING;
                                const answers = r.intakeAnswers as Record<string, string>;
                                const days = daysInStage(r.updatedAt);
                                return (
                                    <Link
                                        key={r.id}
                                        href={`/coach/leads/${r.id}`}
                                        className={`group flex items-center gap-4 rounded-2xl border px-5 py-4 transition-all hover:shadow-md ${
                                            isReadyToActivate
                                                ? "border-amber-500/20 bg-[#0a1224] hover:border-amber-500/40 hover:shadow-amber-500/5"
                                                : "border-white/[0.06] bg-[#0a1224] hover:border-blue-500/20 hover:shadow-blue-500/5"
                                        }`}
                                    >
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-zinc-300">
                                            {r.prospectName[0]?.toUpperCase() ?? "?"}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-[15px] font-semibold text-zinc-100 truncate">{r.prospectName}</p>
                                                {r.source === "EXTERNAL" && (
                                                    <span className="rounded-md bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold text-orange-400">External</span>
                                                )}
                                            </div>
                                            <p className="mt-0.5 text-xs text-zinc-500 truncate">
                                                {isReadyToActivate ? daysAgo(r.formsSignedAt) : (answers?.goals ?? r.prospectEmail)}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {!isReadyToActivate && days > 0 && (
                                                <span className="text-[11px] text-zinc-600">{days}d</span>
                                            )}
                                            {isReadyToActivate ? (
                                                <span className="rounded-full px-3 py-1 text-xs font-semibold text-amber-400 bg-amber-500/10">Activate →</span>
                                            ) : (
                                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stageMeta.color} ${stageMeta.bg}`}>{stageMeta.label}</span>
                                            )}
                                            {r.status !== "PENDING" && r.status !== r.consultationStage && !isReadyToActivate && (
                                                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusMeta.color} ${statusMeta.bg}`}>{statusMeta.label}</span>
                                            )}
                                        </div>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400"><path d="M9 18l6-6-6-6"/></svg>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                );
            })}

            {/* Empty state */}
            {requests.filter((r) => r.status !== "DECLINED" && r.status !== "REJECTED").length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-800 py-14 text-center">
                    <p className="text-sm font-medium text-zinc-400">No active leads</p>
                    <p className="text-xs text-zinc-600">New requests will appear here when clients reach out via your public profile.</p>
                </div>
            )}

            {/* Inactive */}
            {declinedLeads.length > 0 && (
                <section>
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-600">
                        Inactive
                        <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-[11px] font-bold text-zinc-600">{declinedLeads.length}</span>
                    </h2>
                    <div className="space-y-2">
                        {declinedLeads.map((r) => {
                            const answers = r.intakeAnswers as Record<string, string>;
                            return (
                                <Link
                                    key={r.id}
                                    href={`/coach/leads/${r.id}`}
                                    className="flex items-center gap-4 rounded-2xl border border-white/[0.04] bg-zinc-900/30 px-5 py-4 opacity-70 transition-all hover:opacity-100"
                                >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800/50 text-sm font-bold text-zinc-500">
                                        {r.prospectName[0]?.toUpperCase() ?? "?"}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-zinc-400 truncate">{r.prospectName}</p>
                                        <p className="mt-0.5 text-xs text-zinc-600 truncate">{answers?.goals ?? r.prospectEmail}</p>
                                    </div>
                                    <span className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-zinc-500 bg-zinc-800">Inactive</span>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
