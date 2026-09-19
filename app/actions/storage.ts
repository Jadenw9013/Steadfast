"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { consumeQuota } from "@/lib/security/quota";
import { z } from "zod";
import { createSignedUploadUrls as generateUrls } from "@/lib/supabase/storage";
import { validateCheckInPhotoCount } from "@/lib/validations/check-in";
import crypto from "crypto";

export async function createSignedUploadUrls(fileNames: string[]) {
  const user = await getCurrentDbUser();
  const userId = user.clerkId;

  const countValidation = validateCheckInPhotoCount(Array.isArray(fileNames) ? fileNames.length : 0);
  if (!countValidation.valid) {
    return { error: countValidation.error! };
  }

  const nameSchema = z.array(z.string().min(1).max(200));
  const parsed = nameSchema.safeParse(fileNames);
  if (!parsed.success) {
    return { error: "Invalid photo filename." };
  }
  const names = parsed.data;

  if (!await consumeQuota("photo-uploads", user.id, 60, 3600)) {
    return { error: "Upload limit reached. Please try again later." };
  }

  const batchId = crypto.randomUUID();
  const paths = names.map(
    (name, i) => `${userId}/${batchId}/${i}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  );

  return generateUrls(paths);
}
