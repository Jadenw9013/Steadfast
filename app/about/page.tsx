import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "About — Steadfast",
    description: "Learn how Steadfast connects fitness coaches with clients for structured, accountable coaching.",
};

export default function AboutPage() {
    return (
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
            <h1 className="text-3xl font-semibold tracking-tight">About Steadfast</h1>

            <div className="mt-10 space-y-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p>
                    Steadfast is an online coaching platform built to help fitness coaches and their clients stay connected, organized, and accountable — week after week.
                </p>

                <p>
                    We believe that consistency beats intensity. Great results come from showing up every week, tracking progress honestly, and getting guidance from someone who knows your goals. Steadfast gives coaches and clients the tools to make that happen without the friction.
                </p>

                <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">What Steadfast Does</h2>

                <ul className="list-disc space-y-2 pl-5">
                    <li>
                        <strong>Client Check-ins</strong> — Clients submit weekly or daily check-ins with weight, progress photos, diet compliance, energy levels, and notes. Coaches receive everything in a structured inbox.
                    </li>
                    <li>
                        <strong>Meal Plan Management</strong> — Coaches create, edit, and publish personalized meal plans. Clients see exactly what to eat with clear portions and structure.
                    </li>
                    <li>
                        <strong>Messaging</strong> — Built-in coach-client messaging keeps all communication in one place, tied to the context of each week&apos;s check-in.
                    </li>
                    <li>
                        <strong>Progress Tracking</strong> — Automatic weight trend calculations and visual deltas help coaches and clients see what&apos;s working over time.
                    </li>
                    <li>
                        <strong>SMS Notifications</strong> — Optional text message reminders and alerts keep coaches and clients in the loop without needing to open the app. Powered by Twilio with explicit opt-in required.
                    </li>
                </ul>

                <h2 className="pt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Who It&apos;s For</h2>

                <p>
                    Steadfast is designed for independent fitness coaches who manage clients remotely and want a clean, reliable system to replace spreadsheets, email chains, and scattered DMs.
                </p>

                <div className="pt-6">
                    <Link
                        href="/sign-up"
                        className="inline-block rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                        Get Started
                    </Link>
                </div>
            </div>
        </div>
    );
}
