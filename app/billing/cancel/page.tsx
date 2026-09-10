import Link from "next/link";
export default function Page() {
  return <main className="mx-auto max-w-lg px-6 py-20"><h1 className="text-2xl font-semibold">Checkout cancelled</h1><p className="mt-4">No new subscription was completed in this checkout. You can return to Steadfast whenever you are ready.</p><Link className="mt-6 inline-block underline" href="/coach/settings">Return to settings</Link></main>;
}
