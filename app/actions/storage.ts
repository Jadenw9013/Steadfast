"use server";

import { auth } from "@clerk/nextjs/server";
import { createSignedUploadUrls as generateUrls } from "@/lib/supabase/storage";
import crypto from "crypto";

export async function createSignedUploadUrls(fileNames: string[]) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const batchId = crypto.randomUUID();
  const paths = fileNames.map(
    (name, i) => `${userId}/${batchId}/${i}-${name}`
  );

  return generateUrls(paths);
}
