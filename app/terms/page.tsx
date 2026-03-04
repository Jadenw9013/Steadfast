import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service — Steadfast",
    description: "Terms and conditions for using the Steadfast coaching platform.",
};

export default function TermsPage() {
    return (
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
            <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
            <p className="mt-2 text-sm text-zinc-500">Last updated: March 4, 2026</p>

            <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">1. Acceptance of Terms</h2>
                    <p className="mt-2">
                        By accessing or using Steadfast (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the Service.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">2. Description of Service</h2>
                    <p className="mt-2">
                        Steadfast is an online coaching platform that connects fitness coaches with clients. The platform provides tools for managing weekly check-ins, meal plans, messaging, progress tracking, and SMS notifications.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">3. Acceptable Use</h2>
                    <p className="mt-2">You agree to use the Service only for its intended purposes. You may not:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Use the platform for unlawful, abusive, or fraudulent activities.</li>
                        <li>Attempt to gain unauthorized access to other users&apos; accounts or data.</li>
                        <li>Upload harmful, offensive, or infringing content.</li>
                        <li>Interfere with or disrupt the Service or its infrastructure.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">4. Coach and Client Responsibilities</h2>
                    <p className="mt-2">
                        <strong>Coaches</strong> are responsible for the accuracy and appropriateness of the meal plans, advice, and feedback they provide through the platform. Steadfast does not employ coaches and does not verify their credentials or qualifications.
                    </p>
                    <p className="mt-2">
                        <strong>Clients</strong> are responsible for the accuracy of the information they submit (weight, photos, notes) and for following any advice at their own discretion and risk. Clients should consult with a qualified healthcare provider before making significant dietary or exercise changes.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">5. Liability Disclaimer</h2>
                    <p className="mt-2">
                        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, whether express or implied. Steadfast is a technology platform and does not provide medical, nutritional, or fitness advice. We are not liable for any health outcomes, injuries, or damages arising from the use of coaching services facilitated through the platform.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">6. Service Availability</h2>
                    <p className="mt-2">
                        We strive to maintain a highly available service but do not guarantee uninterrupted access. The Service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We are not liable for any loss or inconvenience caused by downtime.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">7. Termination</h2>
                    <p className="mt-2">
                        You may close your account at any time. We reserve the right to suspend or terminate your access to the Service if you violate these Terms or engage in behavior that is harmful to other users or the platform. Upon termination, your data will be deleted in accordance with our Privacy Policy.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">8. Intellectual Property</h2>
                    <p className="mt-2">
                        All content, branding, design, and software comprising the Steadfast platform are the intellectual property of Steadfast and may not be copied, modified, or distributed without written permission. Users retain ownership of the content they upload (photos, notes, etc.) but grant Steadfast a limited license to store and display that content within the platform as necessary to provide the Service.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">9. Changes to Terms</h2>
                    <p className="mt-2">
                        We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the updated Terms. We will make reasonable efforts to notify users of material changes.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">10. Contact</h2>
                    <p className="mt-2">
                        If you have questions about these Terms, please contact us at:{" "}
                        <a href="mailto:wong.jaden@icloud.com" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
                            wong.jaden@icloud.com
                        </a>
                    </p>
                </section>
            </div>
        </div>
    );
}
