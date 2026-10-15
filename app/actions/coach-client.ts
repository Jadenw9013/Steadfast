"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { endCoachClientRelationship } from "@/lib/coach-client/end-relationship";
import { revalidatePath } from "next/cache";

const removeClientSchema = z.object({
  clientId: z.string().min(1),
});

export async function removeClient(input: unknown) {
  const parsed = removeClientSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const user = await getCurrentDbUser();
  if (user.activeRole !== "COACH") throw new Error("Not a coach");

  const assignment = await db.coachClient.findUnique({
    where: {
      coachId_clientId: { coachId: user.id, clientId: parsed.data.clientId },
    },
  });

  if (!assignment) throw new Error("Client not found in your roster");

  // T-2058: one teardown shared with the iOS DELETE route — the row delete,
  // the client's unpublished drafts, the ClientCoachingContext reconciliation
  // and the lead stage commit atomically.
  await endCoachClientRelationship({
    coachClientId: assignment.id,
    coachId: user.id,
    clientId: assignment.clientId,
    endedBy: "COACH",
  });

  revalidatePath("/coach", "layout");
  revalidatePath("/coach/leads");
  return { success: true };
}

const leaveCoachSchema = z.object({
  coachClientId: z.string().min(1),
});

export async function leaveCoach(input: unknown) {
  const parsed = leaveCoachSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") throw new Error("Not a client");

  const assignment = await db.coachClient.findUnique({
    where: { id: parsed.data.coachClientId },
  });

  if (!assignment || assignment.clientId !== user.id) {
    throw new Error("Coach relationship not found");
  }

  // T-2058: the shared teardown (row, drafts, context, lead) in one
  // transaction. A client leaving still declines the coach's lead.
  await endCoachClientRelationship({
    coachClientId: assignment.id,
    coachId: assignment.coachId,
    clientId: user.id,
    endedBy: "CLIENT",
  });

  revalidatePath("/client", "layout");
  return { success: true };
}

const reorderClientsSchema = z.object({
  orderedClientIds: z.array(z.string().min(1)).min(1),
});

export async function reorderClients(input: unknown) {
  const parsed = reorderClientsSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const user = await getCurrentDbUser();
  if (user.activeRole !== "COACH") throw new Error("Not a coach");

  const { orderedClientIds } = parsed.data;

  // Verify all provided clientIds belong to this coach before updating
  const assignments = await db.coachClient.findMany({
    where: { coachId: user.id, clientId: { in: orderedClientIds } },
    select: { id: true, clientId: true },
  });

  if (assignments.length !== orderedClientIds.length) {
    throw new Error("One or more clients not found in your roster");
  }

  const assignmentMap = new Map(assignments.map((a) => [a.clientId, a.id]));

  await db.$transaction(
    orderedClientIds.map((clientId, index) =>
      db.coachClient.update({
        where: { id: assignmentMap.get(clientId)! },
        data: { sortOrder: index },
      })
    )
  );

  revalidatePath("/coach/dashboard");
  return { success: true };
}
