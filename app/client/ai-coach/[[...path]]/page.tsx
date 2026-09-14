import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { AiCoachError } from "@/lib/ai-coach/access";
import { AiCoachExperience } from "@/components/ai-coach/experience";
export default async function AiCoachPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const user = await getCurrentDbUser();
  if (!user.isClient) redirect("/coach/dashboard");
  const { path = [] } = await params;
  if (path.length > 2 || (path[0] && !["start", "intake", "progress", "proposals", "reviews", "settings", "check-in", "sessions"].includes(path[0]))) notFound();
  let data;
  try { data = await getAiWorkspace(user.id); } catch (error) {
    if (!(error instanceof AiCoachError)) throw error;
    return <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-white/10 p-6"><p className="text-blue-400">Steadfast AI Coach</p><h1 className="text-2xl font-semibold text-zinc-100">AI coaching is not available for this account yet</h1><p className="text-zinc-400">The current experience is limited to designated synthetic test accounts while policy, content and operational review are completed.</p><Link href="/client" className="inline-flex min-h-12 items-center rounded-xl bg-blue-600 px-4 text-white">Return home</Link></section>;
  }
  return <AiCoachExperience initial={data} path={path} />;
}
