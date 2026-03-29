import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getMessages } from "@/lib/queries/messages";
import { normalizeToMonday } from "@/lib/utils/date";
import { MessageThread } from "@/components/messages/message-thread";

export default async function ClientMessagesPage() {
  const user = await getCurrentDbUser();

  const coachClient = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: { id: true, coachId: true },
  });

  if (!coachClient) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Messages</h1>
        </div>
        <div
          className="sf-surface-card flex flex-col items-center gap-3 px-8 py-16 text-center"
          style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-zinc-600"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-sm font-semibold text-zinc-300">No coach connected</p>
          <p className="text-sm text-zinc-500">
            Connect with a coach to start messaging.
          </p>
        </div>
      </div>
    );
  }

  const weekOf = normalizeToMonday(new Date());
  const messages = await getMessages(user.id, weekOf);

  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  // Format weekStartDate as YYYY-MM-DD
  const weekStartDate = weekOf.toISOString().slice(0, 10);

  const weekLabel = weekOf.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-white">Messages</h1>
        <span className="sf-section-label mt-1 block">Week of {weekLabel}</span>
      </div>

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
