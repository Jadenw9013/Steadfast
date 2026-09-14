import { db } from "@/lib/db";
import { AiCoachError } from "@/lib/ai-coach/access";
import { getClientProvider } from "./client-provider";
import { getAiWorkspace } from "./ai-coach";
/** Shared provider-discriminated DTO. The human branch retains its existing
 * schemas; it never invents a fake human assignment for AI content. */
export async function getCurrentClientPlan(clientId: string) {
  const provider = await getClientProvider(clientId);
  if (provider.resolutionRequired) throw new AiCoachError("REVISION_CONFLICT", "Your coaching provider needs resolution before showing a current plan.");
  if (provider.origin === "AI") {
    const view = await getAiWorkspace(clientId);
    if (view.origin !== "AI" || view.contextRevision !== provider.revision) throw new AiCoachError("REVISION_CONFLICT", "Your provider changed. Refresh the current plan.");
    return { schemaVersion: 1, origin: "AI" as const, contextRevision: view.contextRevision, permissions: view.permissions, currentPlan: view.activePlan };
  }
  if (provider.origin === "NONE") return { schemaVersion: 1, origin: "NONE" as const, contextRevision: provider.revision, currentPlan: null };
  const [mealPlan, trainingProgram] = await Promise.all([
    db.mealPlan.findFirst({ where: { clientId, publishedAt: { gte: provider.relationshipStartedAt! }, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, include: { items: { orderBy: { sortOrder: "asc" } }, macroTargets: { orderBy: { sortOrder: "asc" } } } }),
    db.trainingProgram.findFirst({ where: { clientId, publishedAt: { gte: provider.relationshipStartedAt! }, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, include: { days: { orderBy: { sortOrder: "asc" }, include: { exercises: { orderBy: { sortOrder: "asc" } }, blocks: { orderBy: { sortOrder: "asc" } } } }, cardio: true } }),
  ]);
  const current = await getClientProvider(clientId);
  if (current.origin !== "HUMAN" || current.revision !== provider.revision || current.coachId !== provider.coachId || current.resolutionRequired) throw new AiCoachError("REVISION_CONFLICT", "Your provider changed. Refresh the current plan.");
  return { schemaVersion: 1, origin: "HUMAN" as const, contextRevision: provider.revision, currentPlan: { mealPlan, trainingProgram } };
}
