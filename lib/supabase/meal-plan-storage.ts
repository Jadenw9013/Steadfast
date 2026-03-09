import { createServiceClient } from "./server";

const BUCKET = "meal-plan-uploads";

/** Check if a Supabase storage error indicates the bucket does not exist. */
export function isBucketMissing(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("bucket not found") ||
    lower.includes("the related resource does not exist") ||
    (lower.includes("not found") && lower.includes("bucket"))
  );
}

export async function createMealPlanUploadUrl(
  storagePath: string
): Promise<{ signedUrl: string; token: string }> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("[meal-plan-storage] Supabase error:", {
      message: error?.message,
      name: error?.name,
      bucket: BUCKET,
      path: storagePath,
    });

    if (isBucketMissing(error?.message)) {
      throw new Error(
        `Storage bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage → New bucket → "${BUCKET}" (private).`
      );
    }
    throw new Error(`Failed to create upload URL: ${error?.message}`);
  }

  return { signedUrl: data.signedUrl, token: data.token };
}

export async function getMealPlanFileUrl(
  storagePath: string
): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 15 * 60); // 15 min TTL

  if (error || !data) {
    if (isBucketMissing(error?.message)) {
      throw new Error(
        `Storage bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage → New bucket → "${BUCKET}" (private).`
      );
    }
    throw new Error(`Failed to get download URL: ${error?.message}`);
  }

  return data.signedUrl;
}

export async function downloadMealPlanFile(
  storagePath: string
): Promise<ArrayBuffer> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) {
    if (isBucketMissing(error?.message)) {
      throw new Error(
        `Storage bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage → New bucket → "${BUCKET}" (private).`
      );
    }
    throw new Error(`Failed to download file: ${error?.message}`);
  }

  return data.arrayBuffer();
}
