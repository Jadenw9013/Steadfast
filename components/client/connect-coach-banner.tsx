"use client";

import { useState } from "react";
import { connectToCoach } from "@/app/actions/coach-connection";
import { useRouter } from "next/navigation";

export function ConnectCoachBanner() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setConnecting(true);
    setError(null);

    try {
      const result = await connectToCoach({ coachCode: code.trim() });
      if ("error" in result && result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 dark:border-zinc-800/80 dark:bg-[#0a1224]">
      <h2 className="text-base font-semibold">Connect to Your Coach</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Enter the coach code provided by your coach to get started.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <label htmlFor="coach-code-input" className="sr-only">
          Coach code
        </label>
        <input
          id="coach-code-input"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. AB3X7K"
          maxLength={10}
          className="w-36 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono uppercase tracking-wider focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          disabled={connecting || !code.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {connecting ? "Connecting..." : "Connect"}
        </button>
      </form>
    </div>
  );
}
