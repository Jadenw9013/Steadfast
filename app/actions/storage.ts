"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { consumeQuota } from "@/lib/security/quota";
import { z } from "zod";
import { createSignedUploadUrls as generateUrls } from "@/lib/supabase/storage";
import crypto from "crypto";

export async function createSignedUploadUrls(fileNames: string[]) {
  const user = await getCurrentDbUser();
  const userId = user.clerkId;
  const names = z.array(z.string().min(1).max(200)).min(1).max(3).parse(fileNames);

  if (!await consumeQuota("photo-uploads", user.id, 60, 3600)) throw new Error("Upload limit reached. Please try again later.");

  const batchId = crypto.randomUUID();
  const paths = names.map(
    (name, i) => `${userId}/${batchId}/${i}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  );

  return generateUrls(paths);
}
