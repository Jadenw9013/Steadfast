import { db } from "@/lib/db";
import { reconcileCoachingContextForClient } from "@/lib/activation";

/** Who ended the relationship. Decides only what happens to the coach's lead. */
export type RelationshipEndedBy = "COACH" | "CLIENT";

/**
 * T-2058 — the single teardown for a CoachClient row, shared by the web
 * `removeClient` and `leaveCoach` Server Actions and the iOS
 * `DELETE /api/coach/clients/[clientId]` route (standing rule 1). Account
 * deletion (`lib/account-deletion/purge.ts`) is a separate path.
 *
 * One transaction, lock order User -> CoachClient -> MealPlan/TrainingProgram
 * -> ClientCoachingContext -> CoachingRequest (the funnel-wide User-first
 * order in lib/leads/activate-lead.ts):
 *  1. delete the row;
 *  2. D5: if the client has no relationship left, delete their unpublished
 *     DRAFT meal plans and training programs so the next coach never opens
 *     or publishes them. Drafts were never shown to the client and CB04
 *     history is PUBLISHED/SUPERSEDED only, so nothing client-facing is lost.
 *     Plans carry no author, so a client still holding another relationship
 *     (the legacy two-row shape, resolutionRequired) keeps them: deleting
 *     would destroy the remaining coach's work.
 *  3. reconcile ClientCoachingContext (A01/CB06);
 *  4. D7: move the coach's lead for this client off ACTIVE. Coach-initiated
 *     removal on web and iOS now land on the same row state:
 *     consultationStage CONSULTATION_DONE, status untouched. DECLINED is
 *     terminal (activateLead refuses BYPASS from it and /coach/leads hides
 *     it), so a coach who removed a client could never re-activate them from
 *     the pipeline, against "the same coach again". A client leaving keeps
 *     the existing DECLINED write. Matching stays on prospectId, as web did;
 *     the email-matched case is T-979.
 *
 * Throws Prisma P2025 if the row is already gone or does not belong to
 * (coachId, clientId); callers have already verified ownership.
 */
export async function endCoachClientRelationship(input: {
  coachClientId: string;
  coachId: string;
  clientId: string;
  endedBy: RelationshipEndedBy;
}) {
  const { coachClientId, coachId, clientId, endedBy } = input;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
    // Defensive (T-2058 review r1 finding 7): a caller passing a coachId or
    // clientId that does not belong to this row gets P2025, never a teardown
    // of someone else's lead.
    await tx.coachClient.delete({ where: { id: coachClientId, coachId, clientId } });

    let deletedDraftMealPlans = 0;
    let deletedDraftTrainingPrograms = 0;
    const remaining = await tx.coachClient.count({ where: { clientId } });
    if (remaining === 0) {
      deletedDraftMealPlans = (await tx.mealPlan.deleteMany({ where: { clientId, status: "DRAFT" } })).count;
      deletedDraftTrainingPrograms = (await tx.trainingProgram.deleteMany({ where: { clientId, status: "DRAFT" } })).count;
    }

    await reconcileCoachingContextForClient(tx, clientId);

    const coachProfile = await tx.coachProfile.findUnique({ where: { userId: coachId }, select: { id: true } });
    if (coachProfile) {
      if (endedBy === "COACH") {
        await tx.coachingRequest.updateMany({
          where: { coachProfileId: coachProfile.id, prospectId: clientId, consultationStage: "ACTIVE" },
          data: { consultationStage: "CONSULTATION_DONE" },
        });
      } else {
        await tx.coachingRequest.updateMany({
          where: { coachProfileId: coachProfile.id, prospectId: clientId, consultationStage: { not: "DECLINED" } },
          data: { consultationStage: "DECLINED", status: "DECLINED" },
        });
      }
    }

    return { deletedDraftMealPlans, deletedDraftTrainingPrograms };
  });
}
