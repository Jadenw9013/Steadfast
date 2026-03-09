import { createServiceClient } from "./server";

const BUCKET = "profile-photos";

export async function createProfilePhotoUploadUrl(
    storagePath: string
): Promise<{ signedUrl: string; token: string }> {
    const supabase = createServiceClient();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);

    if (error || !data) {
        const msg = error?.message?.toLowerCase() ?? "";
        if (msg.includes("bucket not found") || msg.includes("does not exist")) {
            throw new Error(
                `Storage bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage → New bucket → "${BUCKET}" (private).`
            );
        }
        throw new Error(`Failed to create upload URL: ${error?.message}`);
    }

    return { signedUrl: data.signedUrl, token: data.token };
}

export async function getProfilePhotoUrl(
    storagePath: string
): Promise<string> {
    const supabase = createServiceClient();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60 * 60); // 1hr TTL

    if (error || !data) {
        throw new Error(`Failed to get photo URL: ${error?.message}`);
    }

    return data.signedUrl;
}

export async function deleteProfilePhoto(
    storagePath: string
): Promise<void> {
    const supabase = createServiceClient();

    const { error } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);

    if (error) {
        console.error("[profile-photo] Delete error:", error.message);
    }
}
