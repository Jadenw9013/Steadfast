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
                <h1 className="text-2xl font-bold tracking-tight">Invite a Client</h1>
                <p className="mt-1.5 text-sm text-zinc-500">
                    Already working with someone? Enter their details and they&apos;ll get a sign-up link via email. Once they join, they&apos;ll automatically be added to your roster.
                </p>
            </div>

            {/* Form card */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6">
                <InviteForm />
            </div>

            {/* Info */}
            <div className="rounded-xl border border-white/[0.04] bg-zinc-900/30 px-5 py-4">
                <p className="text-xs text-zinc-500 leading-relaxed">
                    <span className="font-medium text-zinc-400">How it works:</span> Your client receives a personalised email with a 7-day sign-up link. When they create their account, they&apos;re immediately connected to you — no coach codes needed.
                </p>
            </div>
        </div>
    );
}
