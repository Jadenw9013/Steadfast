"use client";
import { useRef, useState } from "react";
import type { getReviewerQueue } from "@/lib/ai-coach/reviewer";
import { PlanDisplay } from "./plan-display";
type Queue = Awaited<ReturnType<typeof getReviewerQueue>>;
export function ReviewerWorkspace({ initial }: { initial: Queue }) {
  const [queue, setQueue] = useState(initial);
  const [selected, setSelected] = useState(initial.candidates[0]?.id ?? "");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const candidate = queue.candidates.find(c => c.id === selected);
  async function decide(approved: boolean) {
    if (!candidate || busy) return;
    setBusy(true); setError(""); setMessage("");
    const input = { planId: candidate.id, expectedStateHash: candidate.stateHash, approved, rationale };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const res = await fetch("/api/ops/ai-coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestKey: request.current.key }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error?.message ?? "Decision was not saved.");
      setMessage(approved ? "Approval saved. The client may now review and accept this proposal." : "Rejection saved. This proposal remains hidden from the client.");
      const refreshed = await fetch("/api/ops/ai-coach", { cache: "no-store" }); const fresh = await refreshed.json();
      if (!refreshed.ok) throw new Error("Decision saved, but the queue could not refresh. Reload to continue.");
      setQueue(fresh.data); setSelected(fresh.data.candidates[0]?.id ?? ""); setRationale(""); request.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : "Connection interrupted. Retry with the same decision."); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 text-zinc-100"><header><p className="text-blue-400">Steadfast AI Coach · Synthetic reviewer workspace</p><h1 className="mt-2 text-3xl font-semibold">Proposal review queue</h1><p className="mt-3 text-zinc-400">{queue.backlog} pending proposals · queue capacity {queue.capacity}. This tool does not establish real staffing or clinical approval.</p>{queue.oldestPendingAt && <p className="mt-2 text-sm text-zinc-400">Oldest pending: {new Date(queue.oldestPendingAt).toLocaleString()}</p>}</header>
    {queue.capacityReached && <p role="status" className="rounded-xl border border-amber-500/40 p-4 text-amber-200">Queue capacity reached. Review capacity must be restored before expanding enrollment.</p>}
    {error && <p role="alert" className="rounded-xl border border-red-500/40 p-4 text-red-300">{error}</p>}{message && <p role="status" className="text-emerald-300">{message}</p>}
    {queue.candidates.length ? <label className="block">Assigned proposal<select className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-900 p-3 text-base" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setRationale(""); }} >{queue.candidates.map(c => <option key={c.id} value={c.id}>{c.clientId} · {c.changeClass} · {new Date(c.createdAt).toLocaleDateString()}</option>)}</select></label> : <p className="rounded-2xl border border-white/10 p-6 text-zinc-400">No eligible proposals are assigned to your current capabilities.</p>}
    {candidate && <><PlanDisplay plan={candidate.payload} /><label className="block">Review rationale<textarea maxLength={1000} className="mt-2 min-h-32 w-full rounded-xl border border-white/15 bg-zinc-900 p-3 text-base" style={{ fontSize: "max(1rem, 16px)" }} value={rationale} onChange={e => setRationale(e.target.value)} /><span className="mt-2 block text-sm text-zinc-400">Internal review notes are not displayed in the client’s plan.</span></label><div className="flex flex-wrap gap-3"><button disabled={busy || !rationale.trim()} onClick={() => decide(true)} className="min-h-14 rounded-xl bg-blue-600 px-5 text-white hover:bg-blue-500 disabled:opacity-50">Approve for client review</button><button disabled={busy || !rationale.trim()} onClick={() => decide(false)} className="min-h-12 rounded-xl border border-white/20 px-5 hover:bg-white/10 disabled:opacity-50">Reject proposal</button></div></>}
  </div>;
}
