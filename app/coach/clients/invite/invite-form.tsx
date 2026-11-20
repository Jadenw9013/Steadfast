"use client";

import { useState, useTransition } from "react";
import { sendClientInvite } from "@/app/actions/client-invites";

export function InviteForm() {
    const [pending, startTransition] = useTransition();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [result, setResult] = useState<{ success?: boolean; error?: string; emailSent?: boolean; inviteToken?: string } | null>(null);
    const [copyNotice, setCopyNotice] = useState("");
    const inviteLink = result?.inviteToken ? `${window.location.origin}/invite/${encodeURIComponent(result.inviteToken)}` : "";

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setResult(null);
        setCopyNotice("");
        startTransition(async () => {
            try {
                const res = await sendClientInvite({ name: name.trim(), email: email.trim() });
                setResult(res);
                if ("success" in res && res.success && res.emailSent) {
                    setName("");
                    setEmail("");
                }
            } catch {
                setResult({ error: "We couldn't send the invite. Please try again." });
            }
        });
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <label htmlFor="invite-name" className="mb-1.5 block text-sm font-medium text-zinc-300">
                    Client Name
                </label>
                <input
                    id="invite-name"
                    type="text"
                    required
                    placeholder="Jane Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
                />
            </div>
            <div>
                <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium text-zinc-300">
                    Email Address
                </label>
                <input
                    id="invite-email"
                    type="email"
                    required
                    placeholder="jane@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
                />
            </div>

            {result?.error && (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{result.error}</p>
            )}
            {result && "success" in result && result.success && (
                <div className="space-y-3">
                    <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${result.emailSent ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-amber-500/20 bg-amber-500/10 text-amber-300"}`}>
                        {result.emailSent ? "Invite email accepted for delivery. Your client can use the link to connect." : "The invite is ready, but the email wasn't sent. Copy the private link below or try sending again."}
                    </p>
                    <label className="block space-y-2 text-sm text-zinc-300">
                        <span>Private invite link — share only with this client</span>
                        <input readOnly value={inviteLink} onFocus={event => event.currentTarget.select()} className="sf-input" />
                    </label>
                    <button type="button" className="sf-button-secondary" onClick={async () => {
                        try { await navigator.clipboard.writeText(inviteLink); setCopyNotice("Invite link copied."); }
                        catch { setCopyNotice("Select the link above to copy it."); }
                    }}>Copy invite link</button>
                    {copyNotice && <p role="status" className="text-xs text-zinc-400">{copyNotice}</p>}
                </div>
            )}

            <button
                type="submit"
                disabled={pending}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
                {pending ? "Sending…" : "Send Invite"}
            </button>
        </form>
    );
}
