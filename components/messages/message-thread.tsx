"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

function Avatar({ name, isCoach }: { name: string; isCoach: boolean }) {
  const initial = name?.[0]?.toUpperCase() ?? "?";
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
        isCoach
          ? "bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/30"
          : "bg-gradient-to-br from-zinc-500 to-zinc-700"
      }`}
      aria-hidden
    >
      {initial}
    </div>
  );
}

export function MessageThread({
  messages: initialMessages,
  clientId,
  weekStartDate,
  currentUserId,
  alwaysExpanded = false,
}: {
  messages: Message[];
  clientId: string;
  weekStartDate: string;
  currentUserId: string;
  alwaysExpanded?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [liveMessages, setLiveMessages] = useState<Message[]>(initialMessages);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync SSR messages with client state (when page refreshes)
  useEffect(() => {
    setLiveMessages((prev) => {
      const prevIds = new Set(prev.map((m) => m.id));
      const incomingIds = new Set(initialMessages.map((m) => m.id));
      // Keep optimistic messages not yet confirmed, merge new ones
      const optimistic = prev.filter((m) => m.id.startsWith("optimistic-"));
      const serverMessages = initialMessages.filter(
        (m) => !removedIds.has(m.id)
      );
      // If server has new messages we don't have, use server state + optimistic
      if (
        initialMessages.length !== prev.filter((m) => !m.id.startsWith("optimistic-")).length ||
        initialMessages.some((m) => !prevIds.has(m.id))
      ) {
        return [...serverMessages, ...optimistic];
      }
      return prev;
    });
  }, [initialMessages, removedIds]);

  // Polling for real-time updates
  useEffect(() => {
    if (!expanded && !alwaysExpanded) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/messages?clientId=${clientId}`
        );
        if (!res.ok) return;
        const data = await res.json();
        // API returns { id, content, senderId, createdAt } — normalize to Message shape
        const raw: { id: string; content?: string; body?: string; senderId: string; createdAt: string; sender?: Message["sender"] }[] =
          data.messages ?? [];
        const incoming: Message[] = raw.map((m) => ({
          id: m.id,
          body: m.body ?? m.content ?? "",
          createdAt: m.createdAt,
          sender: m.sender ?? {
            id: m.senderId,
            firstName: m.senderId === currentUserId ? "You" : null,
            lastName: null,
            activeRole: "UNKNOWN",
          },
        }));
        setLiveMessages((prev) => {
          const optimistic = prev.filter((m) => m.id.startsWith("optimistic-"));
          const filtered = incoming.filter((m) => !removedIds.has(m.id));
          return [...filtered, ...optimistic];
        });
      } catch {
        // silent
      }
    };

    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [expanded, alwaysExpanded, clientId, weekStartDate, removedIds, currentUserId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (expanded || alwaysExpanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveMessages.length, expanded, alwaysExpanded]);

  // ── Send ──────────────────────────────────────────────────────

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    // Clear immediately (optimistic)
    setBody("");
    setSending(true);

    // Optimistic message
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      body: trimmed,
      createdAt: new Date().toISOString(),
      sender: {
        id: currentUserId,
        firstName: "You",
        lastName: null,
        activeRole: "UNKNOWN",
      },
    };
    setLiveMessages((prev) => [...prev, optimisticMsg]);

    try {
      await sendMessage({ clientId, weekStartDate, body: trimmed });
      router.refresh();
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      console.error("Failed to send message:", err);
      // Remove optimistic message on failure, restore text
      setLiveMessages((prev) =>
        prev.filter((m) => m.id !== optimisticMsg.id)
      );
      setBody(trimmed);
    } finally {
      setSending(false);
    }
  }

  // ── Unsend / Delete ───────────────────────────────────────────

  const handleUnsend = useCallback(
    async (messageId: string) => {
      // Optimistic removal with animation
      setDeletingIds((prev) => new Set(prev).add(messageId));

      // Wait for CSS animation to play
      setTimeout(async () => {
        setLiveMessages((prev) => prev.filter((m) => m.id !== messageId));
        setRemovedIds((prev) => new Set(prev).add(messageId));
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });

        try {
          const res = await fetch(`/api/messages/${messageId}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            console.error("Failed to unsend on server");
          }
          router.refresh();
        } catch (err) {
          console.error("Unsend error:", err);
        }

        // Keep in removed set for 10s to prevent polling re-add
        setTimeout(() => {
          setRemovedIds((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
        }, 10000);
      }, 300);
    },
    [router]
  );

  // ── Keyboard ──────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as React.FormEvent);
    }
  }

  // ── Render helpers ────────────────────────────────────────────

  const messages = liveMessages;
  const latestMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const previewSender = latestMsg
    ? `${latestMsg.sender.firstName ?? "User"}${latestMsg.sender.activeRole === "COACH" ? " (Coach)" : ""}`
    : null;
  const previewBody = latestMsg
    ? latestMsg.body.slice(0, 60) + (latestMsg.body.length > 60 ? "…" : "")
    : null;

  return (
    <section
      className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a1224] shadow-xl shadow-black/20"
      aria-label="Messages"
    >
      {/* ── Inline animation styles ─────────────────────────────── */}
      <style jsx>{`
        @keyframes msg-poof {
          0% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(0.85);
          }
          100% {
            opacity: 0;
            transform: scale(0.3);
          }
        }
        .msg-deleting {
          animation: msg-poof 0.3s ease-in forwards;
          pointer-events: none;
        }
        @keyframes msg-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .msg-enter {
          animation: msg-enter 0.2s ease-out;
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────── */}
      {alwaysExpanded ? (
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Conversation</h2>
            <p className="text-[11px] text-zinc-500">
              {messages.length === 0
                ? "No messages yet"
                : `${messages.length} message${messages.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
          aria-expanded={expanded}
          aria-controls="message-thread-body"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Messages
            </span>
            {!expanded && latestMsg && (
              <span className="truncate text-xs text-zinc-500">
                <span className="font-medium text-zinc-400">{previewSender}:</span>{" "}
                {previewBody}
              </span>
            )}
            {!expanded && !latestMsg && (
              <span className="text-xs text-zinc-600">No messages yet</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!expanded && messages.length > 0 && (
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-400">
                {messages.length}
              </span>
            )}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-zinc-500 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </button>
      )}

      {/* ── Chat body ───────────────────────────────────────────── */}
      {(expanded || alwaysExpanded) && (
        <div id="message-thread-body" className="flex flex-col">
          <div
            ref={scrollContainerRef}
            className="flex flex-col gap-1.5 overflow-y-auto px-4 py-4"
            style={{
              minHeight: alwaysExpanded ? "360px" : "260px",
              maxHeight: alwaysExpanded ? "520px" : "320px",
            }}
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-zinc-500">No messages yet</p>
                <p className="text-xs text-zinc-600">Send the first message to start the conversation</p>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => {
                  const isOwn = msg.sender.id === currentUserId;
                  const isCoach = msg.sender.activeRole === "COACH";
                  const senderName = msg.sender.firstName ?? "User";
                  const showAvatar =
                    i === 0 || messages[i - 1].sender.id !== msg.sender.id;

                  const msgDate = new Date(msg.createdAt);
                  const prevDate = i > 0 ? new Date(messages[i - 1].createdAt) : null;
                  const showDateSeparator =
                    !prevDate || msgDate.toDateString() !== prevDate.toDateString();
                  const dateLabel = msgDate.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  });
                  const timeStr = msgDate.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  const isDeleting = deletingIds.has(msg.id);
                  const isOptimistic = msg.id.startsWith("optimistic-");

                  return (
                    <div
                      key={msg.id}
                      className={isDeleting ? "msg-deleting" : "msg-enter"}
                    >
                      {/* Date separator */}
                      {showDateSeparator && (
                        <div className="my-3 flex items-center gap-3">
                          <div className="h-px flex-1 bg-white/[0.06]" />
                          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[10px] font-medium text-zinc-500">
                            {dateLabel}
                          </span>
                          <div className="h-px flex-1 bg-white/[0.06]" />
                        </div>
                      )}

                      <div
                        className={`group flex items-end gap-2 ${
                          isOwn ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        {/* Avatar */}
                        <div className="w-7 shrink-0">
                          {showAvatar && !isOwn && (
                            <Avatar name={senderName} isCoach={isCoach} />
                          )}
                        </div>

                        <div
                          className={`relative flex max-w-[75%] flex-col gap-0.5 ${
                            isOwn ? "items-end" : "items-start"
                          }`}
                        >
                          {/* Sender label */}
                          {showAvatar && (
                            <span
                              className={`px-1 text-[10px] font-medium ${
                                isOwn
                                  ? "text-zinc-500"
                                  : isCoach
                                    ? "text-blue-400"
                                    : "text-zinc-500"
                              }`}
                            >
                              {isOwn
                                ? "You"
                                : `${senderName}${isCoach ? " · Coach" : ""}`}
                            </span>
                          )}

                          {/* Bubble + unsend wrapper */}
                          <div className="group/bubble relative">
                            <div
                              className={`relative px-3.5 py-2.5 text-sm leading-relaxed ${
                                isOwn
                                  ? "rounded-2xl rounded-br-sm bg-blue-600 text-white shadow-md shadow-blue-600/20"
                                  : "rounded-2xl rounded-bl-sm bg-zinc-800 text-zinc-100 shadow-sm"
                              } ${isOptimistic ? "opacity-70" : ""}`}
                            >
                              <p className="whitespace-pre-wrap">{msg.body}</p>
                            </div>

                            {/* Unsend button — only for own messages, on hover */}
                            {isOwn && !isOptimistic && (
                              <button
                                type="button"
                                onClick={() => handleUnsend(msg.id)}
                                className="absolute -left-8 top-1/2 -translate-y-1/2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-zinc-800 text-zinc-500 opacity-0 shadow-sm transition-all hover:bg-red-500/20 hover:text-red-400 group-hover/bubble:opacity-100"
                                title="Unsend message"
                                aria-label="Unsend message"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M3 6h18" />
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              </button>
                            )}
                          </div>

                          {/* Timestamp */}
                          <span className="px-1 text-[10px] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
                            {timeStr}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* ── Compose bar ──────────────────────────────────────── */}
          <form
            onSubmit={handleSend}
            className="flex items-end gap-2 border-t border-white/[0.05] bg-[#0a1224] px-3 py-3"
          >
            <label htmlFor="message-input" className="sr-only">
              Type a message
            </label>
            <textarea
              ref={inputRef}
              id="message-input"
              rows={1}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message…"
              style={{
                minHeight: "44px",
                maxHeight: "120px",
                fontSize: "max(1rem, 16px)",
              }}
              className="flex-1 resize-none overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-800/60 px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 transition-colors focus:border-blue-500/50 focus:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              aria-label="Send message"
              style={{ minHeight: "44px", minWidth: "44px" }}
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/30 transition-all hover:bg-blue-500 hover:shadow-blue-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1224] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {sending ? (
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
