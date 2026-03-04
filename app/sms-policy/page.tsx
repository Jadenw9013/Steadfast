import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "SMS Policy — Steadfast",
    description: "How Steadfast uses SMS messaging and how to opt out.",
};

export default function SmsPolicyPage() {
    return (
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
            <h1 className="text-3xl font-semibold tracking-tight">SMS Policy</h1>
            <p className="mt-2 text-sm text-zinc-500">Last updated: March 4, 2026</p>

            <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">1. Opt-In Requirement</h2>
                    <p className="mt-2">
                        Steadfast will never send you SMS messages unless you have explicitly opted in. To receive SMS notifications, you must:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Provide your mobile phone number in your account Settings.</li>
                        <li>Turn on the &quot;Receive SMS Notifications&quot; toggle.</li>
                        <li>Enable one or more specific notification types.</li>
                    </ul>
                    <p className="mt-2">SMS is entirely optional and the platform is fully functional without it.</p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">2. Types of Messages</h2>
                    <p className="mt-2">
                        When opted in, you may receive the following types of transactional SMS messages:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li><strong>Meal plan updates</strong> — when your coach publishes or edits your meal plan.</li>
                        <li><strong>Daily check-in reminders</strong> — a reminder to submit your check-in if you haven&apos;t done so.</li>
                        <li><strong>Coach/client messages</strong> — when you receive a new chat message.</li>
                        <li><strong>Check-in feedback</strong> — when your coach reviews your latest check-in.</li>
                        <li><strong>Missed check-in alerts</strong> (coaches) — when a client misses their daily check-in.</li>
                        <li><strong>New client signups</strong> (coaches) — when a new client joins your roster.</li>
                    </ul>
                    <p className="mt-2">
                        We do not send any marketing, promotional, or advertising messages via SMS.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">3. Message Frequency</h2>
                    <p className="mt-2">
                        Message frequency varies based on coaching activity and your enabled notification types. You control which notification types are active and can adjust them at any time in your Settings.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">4. Message & Data Rates</h2>
                    <p className="mt-2">
                        Message and data rates may apply. Standard carrier messaging charges may be incurred depending on your mobile plan. Steadfast is not responsible for any charges from your wireless provider.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">5. How to Opt Out</h2>
                    <p className="mt-2">
                        You can stop receiving SMS notifications at any time by:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Replying <strong>STOP</strong> to any message from Steadfast.</li>
                        <li>Turning off the SMS opt-in toggle in your account Settings.</li>
                        <li>Removing your phone number from your profile.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">6. Help</h2>
                    <p className="mt-2">
                        Reply <strong>HELP</strong> to any Steadfast SMS for assistance, or contact us at:{" "}
                        <a href="mailto:wong.jaden@icloud.com" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                            wong.jaden@icloud.com
                        </a>
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">7. Related Policies</h2>
                    <p className="mt-2">
                        For more information on how we handle your data, see our{" "}
                        <Link href="/privacy" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">Privacy Policy</Link> and{" "}
                        <Link href="/terms" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">Terms of Service</Link>.
                    </p>
                </section>
            </div>
        </div>
    );
}
