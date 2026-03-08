import { getMyCoachProfile, getMyCoachingRequests } from "@/lib/queries/marketplace";
import { Metadata } from "next";
import { RequestList } from "@/components/coach/marketplace/request-list";

export const metadata: Metadata = {
    title: "Coaching Requests | Steadfast",
};

export default async function CoachingRequestsPage() {
    const profile = await getMyCoachProfile();

    if (!profile) {
        return (
            <div className="mx-auto max-w-3xl">
                <div className="mb-8">
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                        Coaching Requests
                    </h1>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                        You must create a public profile to receive coaching requests.
                    </p>
                </div>
            </div>
        );
    }

    const requests = await getMyCoachingRequests(profile.id);

    const pending = requests.filter((r) => r.status === "PENDING");
    const waitlisted = requests.filter((r) => r.status === "WAITLISTED");
    const history = requests.filter((r) => r.status === "APPROVED" || r.status === "REJECTED");

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-8">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Coaching Requests
                </h1>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    Review and manage inquiries from your public coaching profile.
                </p>
            </div>

            {/* ── Summary badges ── */}
            <div className="mb-8 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-[#121215]">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {pending.length} Needs Review
                    </span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-[#121215]">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {waitlisted.length} Waitlist
                    </span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-[#121215]">
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {history.length} History
                    </span>
                </div>
            </div>

            <div className="space-y-12">
                {/* Pending */}
                <section>
                    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Needs Review ({pending.length})
                    </h2>
                    <RequestList requests={pending} />
                </section>

                {/* Waitlist */}
                {waitlisted.length > 0 && (
                    <section>
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                            Waitlist ({waitlisted.length})
                        </h2>
                        <RequestList requests={waitlisted} variant="waitlist" />
                    </section>
                )}

                {/* History */}
                {history.length > 0 && (
                    <section>
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                            History ({history.length})
                        </h2>
                        <RequestList requests={history} readOnly />
                    </section>
                )}
            </div>
        </div>
    );
}
