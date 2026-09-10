import Link from "next/link";
export default function Page() {
  return <main className="mx-auto max-w-lg px-6 py-20"><h1 className="text-2xl font-semibold">Subscription checkout received</h1><p className="mt-4">Your billing status will update once the payment is confirmed. You can return to Steadfast and refresh Settings.</p><Link className="mt-6 inline-block underline" href="/coach/settings">Return to settings</Link></main>;
}
