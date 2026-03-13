import { getCurrentDbUser } from "@/lib/auth/roles";
import { getMessages } from "@/lib/queries/messages";
import { parseWeekStartDate } from "@/lib/utils/date";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MessageThread } from "@/components/messages/message-thread";

export default async function ClientMessagesPage({
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

  const messages = await getMessages(user.id, weekOf);
  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const weekLabel = weekOf.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <Link
          href="/client"
          className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-0.5">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to dashboard
        </Link>

        <div className="mt-3 flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Messages</h1>
          <span className="rounded-lg bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400">
            Week of {weekLabel}
          </span>
        </div>
      </div>

      {/* Full chat — always open, never a dropdown */}
      <MessageThread
        messages={serializedMessages}
        clientId={user.id}
        weekStartDate={weekStartDate}
        currentUserId={user.id}
        alwaysExpanded={true}
      />
    </div>
  );
}
