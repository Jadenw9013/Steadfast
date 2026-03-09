"use client";

import { useState } from "react";

export function CoachCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
        <span className="text-xs text-zinc-500">Coach Code</span>
        <code className="font-mono text-sm font-semibold tracking-wider">
          {code}
        </code>
        <button
          onClick={handleCopy}
          aria-label={copied ? "Code copied" : "Copy coach code to clipboard"}
          className="rounded px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Share this code with clients — they enter it on their dashboard to join your roster.
      </p>
    </div>
  );
}
