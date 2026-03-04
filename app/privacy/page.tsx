import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Privacy Policy — Steadfast",
    description: "How Steadfast collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
    return (
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
            <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
            <p className="mt-2 text-sm text-zinc-500">Last updated: March 4, 2026</p>

            <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">1. Information We Collect</h2>
                    <p className="mt-2">
                        When you create an account or use Steadfast, we may collect the following information:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li><strong>Name</strong> — first and last name provided during registration.</li>
                        <li><strong>Email address</strong> — used for account authentication and essential communication.</li>
                        <li><strong>Phone number</strong> — optionally provided to enable SMS notifications. Stored securely and never shared with third parties for marketing.</li>
                        <li><strong>Check-in data</strong> — weight, diet compliance, energy level, notes, and progress photos submitted by clients.</li>
                        <li><strong>Usage data</strong> — anonymized analytics to improve the platform experience.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">2. How We Use SMS Notifications</h2>
                    <p className="mt-2">
                        If you provide a phone number and explicitly opt in, Steadfast sends transactional SMS notifications through Twilio. These messages are strictly limited to:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Meal plan updates from your coach</li>
                        <li>Daily check-in reminders</li>
                        <li>New messages from your coach or client</li>
                        <li>Check-in feedback notifications</li>
                        <li>Missed check-in alerts (coaches)</li>
                        <li>New client signup alerts (coaches)</li>
                    </ul>
                    <p className="mt-2">
                        We do not use your phone number for marketing, advertising, or promotional purposes. Your phone number is used solely for the transactional notifications described above and in our{" "}
                        <Link href="/sms-policy" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">SMS Policy</Link>.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">3. How to Opt Out of SMS</h2>
                    <p className="mt-2">
                        You can stop receiving SMS notifications at any time by:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Turning off the SMS opt-in toggle in your Settings page.</li>
                        <li>Removing your phone number from your profile.</li>
                        <li>Replying <strong>STOP</strong> to any message received from Steadfast.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">4. Data Storage & Security</h2>
                    <p className="mt-2">
                        Your data is stored on secure, encrypted servers. We use industry-standard encryption for data in transit (TLS) and at rest. Authentication is managed through Clerk, a third-party identity provider. Progress photos are stored in private cloud storage buckets accessible only through server-signed URLs.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">5. Third-Party Services</h2>
                    <p className="mt-2">
                        Steadfast uses the following third-party services to operate:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li><strong>Clerk</strong> — user authentication and identity management.</li>
                        <li><strong>Twilio</strong> — transactional SMS delivery.</li>
                        <li><strong>Vercel</strong> — application hosting and analytics.</li>
                    </ul>
                    <p className="mt-2">
                        We do not sell, rent, or share your personal data with third parties for their own marketing or advertising purposes.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">6. Your Rights</h2>
                    <p className="mt-2">
                        You may request access to, correction of, or deletion of your personal data at any time by contacting us. Upon account deletion, all associated personal data will be permanently removed.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">7. Contact</h2>
                    <p className="mt-2">
                        If you have questions about this Privacy Policy or your data, please contact us at:{" "}
                        <a href="mailto:wong.jaden@icloud.com" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                            wong.jaden@icloud.com
                        </a>
                    </p>
                </section>
            </div>
        </div>
    );
}
