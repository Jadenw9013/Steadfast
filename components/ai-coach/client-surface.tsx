import Link from "next/link";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { AiCoachError } from "@/lib/ai-coach/access";
import { AiCoachExperience } from "./experience";
export function ProviderResolution() { return <section className="space-y-4 rounded-2xl border border-white/10 p-6 text-zinc-100"><h1 className="text-2xl">Your coaching provider needs review</h1><p className="text-zinc-400">We could not establish one current provider. Current instructions are unavailable until this is resolved.</p><Link className="inline-flex min-h-12 items-center rounded-xl border border-white/15 px-4" href="/client/profile">Account and support</Link></section>; }
export async function AiClientSurface({ clientId, path = [] }: { clientId: string; path?: string[] }) {
  let initial;
  try { initial = await getAiWorkspace(clientId); }
  catch (error) {
    if (!(error instanceof AiCoachError)) throw error;
    return <section className="space-y-4 rounded-2xl border border-white/10 p-6 text-zinc-100"><p className="text-blue-400">Steadfast AI Coach</p><h1 className="text-2xl">AI coaching is currently unavailable</h1><p className="text-zinc-400">Your account’s current provider is AI Coach. Its instructions are unavailable while access or release requirements are unresolved.</p><Link className="inline-flex min-h-12 items-center rounded-xl border border-white/15 px-4" href="/client/profile">Account and support</Link></section>;
  }
  return <AiCoachExperience initial={initial} path={path} />;
}
