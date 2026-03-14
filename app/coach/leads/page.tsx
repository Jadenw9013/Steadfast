import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import Link from "next/link";
import { Metadata } from "next";

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
    DECLINED:      { label: "Declined",      color: "text-zinc-500",    bg: "bg-zinc-800" },
    REJECTED:      { label: "Declined",      color: "text-zinc-500",    bg: "bg-zinc-800" },
    WAITLISTED:    { label: "Waitlisted",    color: "text-zinc-400",    bg: "bg-zinc-800" },
};

const ACTIVE_GROUPS = ["PENDING", "CONTACTED", "CALL_SCHEDULED"] as const;

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

    const activeLeads = requests.filter((r) => ACTIVE_GROUPS.includes(r.status as typeof ACTIVE_GROUPS[number]));
    const closedLeads = requests.filter((r) => !ACTIVE_GROUPS.includes(r.status as typeof ACTIVE_GROUPS[number]));

    return (
        <div className="space-y-10">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
                    <p className="mt-1 text-sm text-zinc-500">Manage your incoming coaching requests</p>
                </div>
                <Link
                    href="/coach/clients/invite"
                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.97]"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                    Invite Client
                </Link>
            </div>

            {/* Active pipeline */}
            <section>
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                    Active
                    <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] font-bold text-zinc-400">{activeLeads.length}</span>
                </h2>
                {activeLeads.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-800 py-14 text-center">
                        <p className="text-sm font-medium text-zinc-400">No active leads</p>
                        <p className="text-xs text-zinc-600">New requests will appear here when clients reach out via your public profile.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {activeLeads.map((r) => {
                            const meta = STATUS_META[r.status] ?? STATUS_META.PENDING;
                            const answers = r.intakeAnswers as Record<string, string>;
                            return (
                                <Link
                                    key={r.id}
                                    href={`/coach/leads/${r.id}`}
                                    className="group flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-[#0a1224] px-5 py-4 transition-all hover:border-blue-500/20 hover:shadow-md hover:shadow-blue-500/5"
                                >
                                    {/* Avatar */}
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-zinc-300">
                                        {r.prospectName[0]?.toUpperCase() ?? "?"}
                                    </div>
                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[15px] font-semibold text-zinc-100 truncate">{r.prospectName}</p>
                                        <p className="mt-0.5 text-xs text-zinc-500 truncate">{answers?.goals ?? r.prospectEmail}</p>
                                    </div>
                                    {/* Status */}
                                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${meta.color} ${meta.bg}`}>{meta.label}</span>
                                    {/* Arrow */}
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400"><path d="M9 18l6-6-6-6"/></svg>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Closed */}
            {closedLeads.length > 0 && (
                <section>
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-600">
                        Closed
                        <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-[11px] font-bold text-zinc-600">{closedLeads.length}</span>
                    </h2>
                    <div className="space-y-2">
                        {closedLeads.map((r) => {
                            const meta = STATUS_META[r.status] ?? STATUS_META.DECLINED;
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
                                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${meta.color} ${meta.bg}`}>{meta.label}</span>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
