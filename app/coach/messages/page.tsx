import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachClientsWithWeekStatus } from "@/lib/queries/check-ins";
import Link from "next/link";

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  return `${diffDays}d ago`;
}

const RING_GRADIENT: Record<string, string> = {
  overdue:   "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
  due:       "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
  submitted: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
  reviewed:  "linear-gradient(135deg, #10b981 0%, #2dd4bf 100%)",
  upcoming:  "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)",
  new:       "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
  missing:   "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
  not_due:   "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)",
};

export default async function CoachMessagesPage() {
  const user = await getCurrentDbUser();
  const clients = await getCoachClientsWithWeekStatus(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-white">Messages</h1>
        <p className="mt-1 text-sm text-zinc-500">Your client conversations</p>
      </div>

      {clients.length === 0 ? (
        <div
          className="sf-surface-card flex flex-col items-center gap-3 px-8 py-16 text-center"
          style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}
        >
          <p className="text-sm font-semibold text-zinc-300">No clients yet</p>
          <p className="text-sm text-zinc-500">Add clients to start conversations.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((client) => {
            const statusKey = client.cadenceStatus ?? client.weekStatus;
            const ringGradient = RING_GRADIENT[statusKey] ?? RING_GRADIENT.not_due;

            return (
              <Link
                key={client.id}
                href={`/coach/clients/${client.id}`}
                className="group flex items-center gap-3 sf-glass-card p-4 transition-all hover:border-white/[0.16] hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:gap-4 sm:p-5"
              >
                {/* Avatar with gradient ring */}
                <div
                  className="relative h-12 w-12 shrink-0 rounded-full p-[2px]"
                  style={{ background: ringGradient }}
                >
                  {client.profilePhotoUrl ? (
                    <img
                      src={client.profilePhotoUrl}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-full bg-[#111c30] text-sm font-bold text-zinc-100">
                      {client.firstName?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  {client.hasClientMessage && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-60 motion-safe:animate-ping" />
                      <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[#0d1829] bg-purple-500" />
                    </span>
                  )}
                </div>

                {/* Name + subtitle */}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-snug text-zinc-100">
                    {client.firstName} {client.lastName}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {client.submittedAt
                      ? `Latest check-in: ${client.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : "No check-in yet"}
                  </p>
                </div>

                {/* Time ago + chevron */}
                <div className="flex shrink-0 items-center gap-2">
                  {client.submittedAt && (
                    <span className="text-xs text-zinc-500">{formatTimeAgo(client.submittedAt)}</span>
                  )}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-zinc-600 transition-colors group-hover:text-zinc-400"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
