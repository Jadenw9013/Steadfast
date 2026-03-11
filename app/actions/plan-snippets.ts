"use server";

import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";

export type SnippetType = "supplements" | "override" | "rules" | "allowances";

// ── Save ─────────────────────────────────────────────────────────────────────

export async function savePlanSnippet(
  type: SnippetType,
  name: string,
  payload: unknown
) {
  const user = await getCurrentDbUser();

  // JSON round-trip ensures the value is a clean InputJsonValue for Prisma
  const snippet = await db.planSnippet.create({
    data: {
      coachId: user.id,
      type,
      name: name.trim(),
      payload: JSON.parse(JSON.stringify(payload)),
    },
  });

  return { id: snippet.id, name: snippet.name };
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listPlanSnippets(type: SnippetType) {
  const user = await getCurrentDbUser();

  return db.planSnippet.findMany({
    where: { coachId: user.id, type },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

// ── Get ──────────────────────────────────────────────────────────────────────

export async function getPlanSnippet(id: string) {
  const user = await getCurrentDbUser();

  const snippet = await db.planSnippet.findFirst({
    where: { id, coachId: user.id },
  });

  if (!snippet) throw new Error("Snippet not found");

  return {
    id: snippet.id,
    name: snippet.name,
    type: snippet.type as SnippetType,
    payload: snippet.payload,
  };
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deletePlanSnippet(id: string) {
  const user = await getCurrentDbUser();

  await db.planSnippet.deleteMany({
    where: { id, coachId: user.id },
  });

  return { success: true };
}
