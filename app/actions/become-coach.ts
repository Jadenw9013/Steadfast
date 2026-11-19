"use server";

import { getCurrentDbUser, ensureCoachCode } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

import { checkCoachRegistration } from "@/lib/security/coach-registration";

export async function becomeCoach(input: unknown) {
  const user = await getCurrentDbUser();

  const check = await checkCoachRegistration(user.id, input);
  if (!check.ok) return { error: check.error };

  if (user.isCoach) {
    return { error: "You already have coach access." };
  }

  // Grant coach capabilities
  await db.user.update({
    where: { id: user.id },
    data: {
      isCoach: true,
      isClient: true,
      activeRole: "COACH",
    },
  });

  // Ensure they have a coach code
  await ensureCoachCode(user.id);

  console.warn(`[become-coach] SUCCESS userId=${user.id} at=${new Date().toISOString()}`);

  redirect("/coach/dashboard");
}
