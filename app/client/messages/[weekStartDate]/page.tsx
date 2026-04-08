import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getMessages } from "@/lib/queries/messages";
import { parseWeekStartDate } from "@/lib/utils/date";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MessageThread } from "@/components/messages/message-thread";

export default async function ClientWeekMessagesPage({
  params,
}: {
  params: Promise<{ weekStartDate: string }>;
}) {
  const { weekStartDate } = await params;
  const user = await getCurrentDbUser();

  let weekOf: Date;
  try {
    weekOf = parseWeekStartDate(weekStartDate);
  } catch {
    notFound();
  }

  const coachClient = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: {
      coach: { select: { firstName: true } },
    },
  });

  const messages = await getMessages(user.id, weekOf);
  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const coachName = coachClient?.coach.firstName ?? "Coach";
  const weekLabel = weekOf.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

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
            <p className="text-[11px] text-zinc-500">Week of {weekLabel}</p>
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
