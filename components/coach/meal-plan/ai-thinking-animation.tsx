"use client";

import { useEffect, useState } from "react";

const STAGES = [
  { text: "Analyzing your plan", icon: "🔍" },
  { text: "Building changes", icon: "⚙️" },
  { text: "Preparing preview", icon: "✨" },
];

export function AiThinkingAnimation() {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const stage = STAGES[stageIndex];

  return (
    <div className="space-y-4">
      {/* Glowing header */}
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center">
          {/* Pulsing glow ring */}
          <div className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
          <div className="absolute inset-0 animate-pulse rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30" />
          <span className="relative text-lg">{stage.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {stage.text}
            <span className="ai-dots ml-0.5">
              <span className="ai-dot">.</span>
              <span className="ai-dot">.</span>
              <span className="ai-dot">.</span>
            </span>
          </p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            This usually takes a few seconds
          </p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="flex gap-1">
        {STAGES.map((s, i) => (
          <div
            key={s.text}
            className={`h-1 flex-1 rounded-full transition-all duration-700 ${
              i <= stageIndex
                ? "bg-gradient-to-r from-blue-500 to-purple-500"
                : "bg-zinc-200 dark:bg-zinc-700"
            }`}
          />
        ))}
      </div>

      {/* Skeleton preview cards */}
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="ai-shimmer overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50"
            style={{ animationDelay: `${i * 200}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="h-3 w-16 rounded bg-zinc-200/80 dark:bg-zinc-700" />
              <div className="h-3 w-24 rounded bg-zinc-200/60 dark:bg-zinc-700/60" />
              <div className="ml-auto h-3 w-12 rounded bg-zinc-200/40 dark:bg-zinc-700/40" />
            </div>
          </div>
        ))}
      </div>

      {/* CSS for animations */}
      <style jsx>{`
        .ai-dots .ai-dot {
          animation: ai-dot-fade 1.4s infinite;
          opacity: 0;
        }
        .ai-dots .ai-dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        .ai-dots .ai-dot:nth-child(3) {
          animation-delay: 0.4s;
        }
        @keyframes ai-dot-fade {
          0%,
          80%,
          100% {
            opacity: 0;
          }
          40% {
            opacity: 1;
          }
        }
        .ai-shimmer {
          position: relative;
        }
        .ai-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.08) 50%,
            transparent 100%
          );
          animation: ai-shimmer-sweep 2s infinite;
        }
        @keyframes ai-shimmer-sweep {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        @media (prefers-color-scheme: dark) {
          .ai-shimmer::after {
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(255, 255, 255, 0.04) 50%,
              transparent 100%
            );
          }
        }
      `}</style>
    </div>
  );
}
