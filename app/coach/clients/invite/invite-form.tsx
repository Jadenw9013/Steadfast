"use client";

import { useState, useTransition } from "react";
import { sendClientInvite } from "@/app/actions/client-invites";

export function InviteForm() {
    const [pending, startTransition] = useTransition();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setResult(null);
        startTransition(async () => {
            const res = await sendClientInvite({ name: name.trim(), email: email.trim() });
            setResult(res);
            if (res && "success" in res && res.success) {
                setName("");
                setEmail("");
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
                <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                    ✓ Invite sent! They&apos;ll receive an email with a sign-up link valid for 7 days.
                </p>
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
