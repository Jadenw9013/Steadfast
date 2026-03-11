"use client";

import { useState, useRef, useEffect } from "react";
import { sendMessage } from "@/app/actions/messages";
import { useRouter } from "next/navigation";

type Message = {
  id: string;
  body: string;
  createdAt: string;
  sender: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    activeRole: string;
  };
};

export function MessageThread({
  messages,
  clientId,
  weekStartDate,
  currentUserId,
}: {
  messages: Message[];
  clientId: string;
  weekStartDate: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setSending(true);
    try {
      await sendMessage({ clientId, weekStartDate, body: body.trim() });
      setBody("");
      router.refresh();
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      className="flex flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      aria-label="Messages"
    >
      <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Messages</h3>
      </div>

      <div
        className="flex-1 space-y-3 overflow-y-auto p-4"
        style={{ maxHeight: "320px" }}
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-center text-sm text-zinc-400">No messages yet</p>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender.id === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    isOwn
                      ? "bg-zinc-900 text-white dark:bg-blue-600 dark:text-white"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  <p className="mb-0.5 text-xs font-medium opacity-70">
                    {msg.sender.firstName ?? "User"}
                    {msg.sender.activeRole === "COACH" ? " (Coach)" : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p className="mt-1 text-xs opacity-50">
                    {new Date(msg.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <label htmlFor="message-input" className="sr-only">
          Type a message
        </label>
        <input
          id="message-input"
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          aria-label="Send message"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {sending ? "..." : "Send"}
        </button>
      </form>
    </section>
  );
}
