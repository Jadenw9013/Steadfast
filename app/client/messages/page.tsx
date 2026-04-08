import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import Link from "next/link";
import { getAllMessages } from "@/lib/queries/messages";
import { normalizeToMonday } from "@/lib/utils/date";
import { MessageThread } from "@/components/messages/message-thread";

export default async function ClientMessagesPage() {
  const user = await getCurrentDbUser();

  const coachClient = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: {
      id: true,
      coachId: true,
      coach: {
        select: { firstName: true, lastName: true },
      },
    },
  });

  if (!coachClient) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Messages</h1>
        </div>
        <div
          className="sf-surface-card flex flex-col items-center gap-5 px-8 py-20 text-center"
          style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/60">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-zinc-100">Messages requires a coach</p>
            <p className="text-sm text-zinc-400">Once you connect with a coach, this will unlock automatically.</p>
          </div>
          <Link href="/coaches" className="sf-button-primary block" style={{ minHeight: "48px" }}>
            Find a Coach
          </Link>
        </div>
      </div>
    );
  }

  const messages = await getAllMessages(user.id);

  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const weekStartDate = normalizeToMonday(new Date()).toISOString().slice(0, 10);
  const coachName = coachClient.coach.firstName ?? "Coach";

  return (
    <div
      className="flex flex-col -mx-4 -mt-6 sm:-mx-8 sm:-mt-8"
      style={{ height: "calc(100dvh - 56px)" }}
    >
      {/* DM header bar */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 sm:px-6">
        <Link
          href="/client"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label="Back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-[11px] font-bold text-white">
            {coachName[0]?.toUpperCase() ?? "C"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{coachName}</p>
            <p className="text-[11px] text-zinc-500">Your Coach</p>
          </div>
        </div>
      </div>

      {/* Full-height message thread */}
      <MessageThread
        messages={serializedMessages}
        clientId={user.id}
        weekStartDate={weekStartDate}
        currentUserId={user.id}
        fullScreen={true}
        coachName={coachName}
      />
    </div>
  );
}
