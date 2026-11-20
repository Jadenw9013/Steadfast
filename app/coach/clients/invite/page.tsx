import { getCurrentDbUser } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invite Client | Steadfast" };

export default async function InviteClientPage() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) redirect("/client");

    return (
        <div className="mx-auto max-w-lg space-y-8">
            {/* Back */}
            <Link href="/coach/leads" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                Leads
            </Link>

            {/* Header */}
            <div>
                <h1 className="text-2xl font-black tracking-tight">Invite a Client</h1>
                <p className="mt-1.5 text-sm text-zinc-500">
                    Already working with someone? Send one invite link. They can sign in or create an account, then accept your invite to join your roster.
                </p>
            </div>

            {/* Form card */}
            <div className="sf-glass-card p-6">
                <InviteForm />
            </div>

            {/* Info */}
            <div className="sf-glass-card px-5 py-4">
                <p className="text-xs text-zinc-500 leading-relaxed">
                    <span className="font-medium text-zinc-400">How it works:</span> Your client receives a personalised invite link valid for 7 days. New and existing clients use the same entry. Accepting the invite connects them to you — no coach codes or repeat coaching requests needed.
                </p>
            </div>
        </div>
    );
}
