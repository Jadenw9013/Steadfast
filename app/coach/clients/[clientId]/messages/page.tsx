import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MessageThread } from "@/components/messages/message-thread";
import { normalizeToMonday } from "@/lib/utils/date";

export default async function CoachClientMessagesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await getCurrentDbUser();

  // Verify coach has this client
  const assignment = await db.coachClient.findUnique({
    where: { coachId_clientId: { coachId: user.id, clientId } },
    select: {
      client: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!assignment) notFound();

  const client = assignment.client;
  const clientName = [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";

  // Fetch ALL messages for this client
  const messages = await db.message.findMany({
    where: { clientId },
    orderBy: { createdAt: "asc" },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, activeRole: true },
      },
    },
  });

  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const weekStartDate = normalizeToMonday(new Date()).toISOString().slice(0, 10);

  return (
    <div
      className="flex flex-col -mx-4 -mt-6 sm:-mx-8 sm:-mt-8"
      style={{ height: "calc(100dvh - 56px)" }}
    >
      {/* DM header bar */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 sm:px-6">
        <Link
          href="/coach/messages"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label="Back to messages"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[11px] font-bold text-white">
            {client.firstName?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{clientName}</p>
            <p className="text-[11px] text-zinc-500">Client</p>
          </div>
        </div>

        {/* Link to client detail page */}
        <Link
          href={`/coach/clients/${clientId}`}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          Profile
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </Link>
      </div>

      {/* Full-height message thread */}
      <MessageThread
        messages={serializedMessages}
        clientId={clientId}
        weekStartDate={weekStartDate}
        currentUserId={user.id}
        fullScreen={true}
        coachName={clientName}
      />
    </div>
  );
}
