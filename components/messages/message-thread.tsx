"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { sendMessage } from "@/app/actions/messages";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
        isCoach
          ? "bg-gradient-to-br from-blue-500 to-indigo-600"
          : "bg-gradient-to-br from-zinc-500 to-zinc-700"
      }`}
      aria-hidden
    >
      {initial}
    </div>
  );
}

// ── Check-in message parsing ────────────────────────────────────────────────

const CHECKIN_REGEX = /^\[CHECKIN:([a-zA-Z0-9_-]+):([^\]]+)\]([\s\S]*)$/;

function parseCheckInMessage(body: string): { checkInId: string; date: string; notes: string } | null {
  const match = body.match(CHECKIN_REGEX);
  if (!match) return null;
  return { checkInId: match[1], date: match[2], notes: match[3].trim() };
}

function CheckInCard({
  checkInId,
  date,
  notes,
  clientId,
  isCoach,
}: {
  checkInId: string;
  date: string;
  notes: string;
  clientId: string;
  isCoach: boolean;
}) {
  const href = isCoach
    ? `/coach/clients/${clientId}/check-ins/${checkInId}`
    : `/client/check-ins/${checkInId}`;

  return (
    <Link
      href={href}
      className="group/checkin block w-full max-w-[320px] rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 to-blue-500/5 p-3.5 transition-all hover:border-indigo-500/30 hover:from-indigo-500/15 hover:to-blue-500/10 hover:shadow-lg hover:shadow-indigo-500/5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <span className="text-xs font-bold uppercase tracking-wide text-indigo-300">
            Check-In Notes
          </span>
          <span className="text-[10px] text-indigo-400/60">· {date}</span>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 transition-transform group-hover/checkin:translate-x-0.5">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>

      {/* Notes body */}
      {notes && notes !== "Check-in submitted" && (
        <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-zinc-200">
          {notes}
        </p>
      )}

      {/* CTA */}
      <p className="mt-2.5 text-right text-xs font-medium text-indigo-400 transition-colors group-hover/checkin:text-indigo-300">
        Tap to review check-in →
      </p>
    </Link>
  );
}

export function MessageThread({
  messages: initialMessages,
  clientId,
  weekStartDate,
  currentUserId,
  alwaysExpanded = false,
  fullScreen = false,
  coachName,
}: {
  messages: Message[];
  clientId: string;
  weekStartDate: string;
  currentUserId: string;
  alwaysExpanded?: boolean;
  fullScreen?: boolean;
  coachName?: string;
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
    if (!expanded && !alwaysExpanded && !fullScreen) return;

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

    // Poll immediately on mount, then every 4s
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [expanded, alwaysExpanded, fullScreen, clientId, weekStartDate, removedIds, currentUserId]);

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

  // When fullScreen, force expanded
  const isExpanded = fullScreen || expanded || alwaysExpanded;

  return (
    <section
      className={`flex flex-col overflow-hidden ${
        fullScreen
          ? "flex-1 min-h-0"
          : "sf-glass-card shadow-xl shadow-black/20"
      }`}
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
      {fullScreen ? null : alwaysExpanded ? (
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Conversation</h2>
            <p className="text-[11px] text-zinc-400">
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
          className="flex w-full items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
          aria-expanded={expanded}
          aria-controls="message-thread-body"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-500/15">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-zinc-200">
              Messages
            </span>
            {!expanded && latestMsg && (
              <span className="truncate text-xs text-zinc-400">
                <span className="font-semibold text-zinc-300">{previewSender}:</span>{" "}
                {previewBody}
              </span>
            )}
            {!expanded && !latestMsg && (
              <span className="text-xs text-zinc-500">No messages yet</span>
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
      {isExpanded && (
        <div id="message-thread-body" className={`flex flex-col ${fullScreen ? "flex-1 min-h-0" : ""}`}>
          <div
            ref={scrollContainerRef}
            className={`flex flex-col gap-1.5 overflow-y-auto px-4 py-4 ${
              fullScreen ? "flex-1" : ""
            }`}
            style={
              fullScreen
                ? {}
                : {
                    minHeight: alwaysExpanded ? "360px" : "260px",
                    maxHeight: alwaysExpanded ? "520px" : "320px",
                  }
            }
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-300">No messages yet</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Start the conversation</p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => {
                  const isOwn = msg.sender.id === currentUserId;
                  const isCoach = msg.sender.activeRole === "COACH";
                  const senderName = msg.sender.firstName ?? "User";

                  // Grouping logic: consecutive messages from the same sender
                  const prevMsg = i > 0 ? messages[i - 1] : null;
                  const nextMsg = i < messages.length - 1 ? messages[i + 1] : null;
                  const sameSenderAsPrev = prevMsg?.sender.id === msg.sender.id;
                  const sameSenderAsNext = nextMsg?.sender.id === msg.sender.id;
                  const isFirstInGroup = !sameSenderAsPrev;
                  const isLastInGroup = !sameSenderAsNext;

                  const msgDate = new Date(msg.createdAt);
                  const prevDate = prevMsg ? new Date(prevMsg.createdAt) : null;
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

                  // If date separator is shown, force "first in group"
                  const effectiveFirstInGroup = isFirstInGroup || showDateSeparator;

                  // Bubble corner radius based on grouping position
                  const ownBubbleRadius = `rounded-2xl ${
                    effectiveFirstInGroup && isLastInGroup
                      ? "rounded-br-md"
                      : effectiveFirstInGroup
                        ? "rounded-br-md"
                        : isLastInGroup
                          ? "rounded-tr-md rounded-br-md"
                          : "rounded-r-md"
                  }`;
                  const otherBubbleRadius = `rounded-2xl ${
                    effectiveFirstInGroup && isLastInGroup
                      ? "rounded-bl-md"
                      : effectiveFirstInGroup
                        ? "rounded-bl-md"
                        : isLastInGroup
                          ? "rounded-tl-md rounded-bl-md"
                          : "rounded-l-md"
                  }`;

                  return (
                    <div
                      key={msg.id}
                      className={`${
                        isDeleting ? "msg-deleting" : "msg-enter"
                      } ${effectiveFirstInGroup ? "mt-3" : "mt-0.5"}`}
                    >
                      {/* Date separator */}
                      {showDateSeparator && (
                        <div className="mb-3 mt-4 flex justify-center first:mt-0">
                          <span className="rounded-full bg-white/[0.08] px-3 py-1 text-[10px] font-semibold text-zinc-400">
                            {dateLabel}
                          </span>
                        </div>
                      )}

                      <div
                        className={`group flex items-end gap-2 ${
                          isOwn ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        {/* Avatar — only for others, only on last message in group */}
                        {!isOwn && (
                          <div className="w-7 shrink-0">
                            {isLastInGroup && (
                              <Avatar name={senderName} isCoach={isCoach} />
                            )}
                          </div>
                        )}

                        <div
                          className={`relative flex max-w-[78%] flex-col gap-0.5 ${
                            isOwn ? "items-end" : "items-start"
                          }`}
                        >
                          {/* Sender label — only on first in group, only for others */}
                          {effectiveFirstInGroup && !isOwn && (
                            <span
                              className={`mb-0.5 px-1 text-[10px] font-semibold ${
                                isCoach ? "text-blue-400" : "text-zinc-500"
                              }`}
                            >
                              {senderName}
                            </span>
                          )}

                          {/* Bubble + unsend wrapper */}
                          <div className="group/bubble relative">
                            {(() => {
                              const checkIn = parseCheckInMessage(msg.body);
                              if (checkIn) {
                                return (
                                  <CheckInCard
                                    checkInId={checkIn.checkInId}
                                    date={checkIn.date}
                                    notes={checkIn.notes}
                                    clientId={clientId}
                                    isCoach={currentUserId !== clientId}
                                  />
                                );
                              }
                              return (
                                <div
                                  className={`relative px-3.5 py-2 text-[15px] leading-relaxed ${
                                    isOwn
                                      ? `${ownBubbleRadius} bg-blue-600 text-white`
                                      : `${otherBubbleRadius} bg-[#1e1e22] text-zinc-100 border border-white/[0.10]`
                                  } ${isOptimistic ? "opacity-60" : ""}`}
                                >
                                  <p className="whitespace-pre-wrap">{msg.body}</p>
                                </div>
                              );
                            })()}

                            {/* Unsend button */}
                            {isOwn && !isOptimistic && !parseCheckInMessage(msg.body) && (
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

                          {/* Timestamp — shown on last message in group */}
                          {isLastInGroup && (
                            <span className="mt-0.5 px-1 text-[10px] text-zinc-500">
                              {timeStr}
                            </span>
                          )}
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
            className={`flex items-end gap-2.5 border-t border-white/[0.08] px-4 py-3 ${
              fullScreen ? "mb-14 sm:mb-0" : ""
            }`}
            style={
              fullScreen
                ? {
                    paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
                    background: "rgba(10, 10, 11, 0.9)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                  }
                : undefined
            }
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
                minHeight: "40px",
                maxHeight: "120px",
                fontSize: "max(1rem, 16px)",
              }}
              className="flex-1 resize-none overflow-hidden rounded-full bg-white/[0.08] border border-white/[0.12] px-4 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-400/40 transition-colors"
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              aria-label="Send message"
              style={{ minHeight: "40px", minWidth: "40px" }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:bg-zinc-700 hover:bg-blue-500"
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
