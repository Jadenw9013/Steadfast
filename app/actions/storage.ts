"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { createSignedUploadUrls as generateUrls } from "@/lib/supabase/storage";
import { validateCheckInUploadFiles } from "@/lib/security/upload-validation";
import { rateLimitAction } from "@/lib/security/rate-limit";
import crypto from "crypto";

export async function createSignedUploadUrls(fileNames: string[]) {
  // Rate limit
  await rateLimitAction("checkin-upload");

  // Auth — use full DB user for consistent identity
  const user = await getCurrentDbUser();

  if (user.activeRole !== "CLIENT") {
    throw new Error("Only clients can upload check-in photos");
  }

  // Server-side validation of file names and count
  const validation = validateCheckInUploadFiles(fileNames);
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid upload request");
  }

  // Build deterministic paths: userId/batchId/index-filename
  const batchId = crypto.randomUUID();
  const paths = fileNames.map(
    (name, i) => `${user.id}/${batchId}/${i}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  );

  return generateUrls(paths);
}
