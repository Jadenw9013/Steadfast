import { createServiceClient } from "./server";

const BUCKET = "portfolio-media";

function isBucketMissing(message: string | undefined): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    return (
        lower.includes("bucket not found") ||
        lower.includes("does not exist") ||
        (lower.includes("not found") && lower.includes("bucket"))
    );
}

export async function createPortfolioMediaUploadUrl(
    storagePath: string
): Promise<{ signedUrl: string; token: string }> {
    const supabase = createServiceClient();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);

    if (error || !data) {
        if (isBucketMissing(error?.message)) {
            throw new Error(
                `Storage bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage → New bucket → "${BUCKET}" (private).`
            );
        }
        throw new Error(`Failed to create upload URL: ${error?.message}`);
    }

    return { signedUrl: data.signedUrl, token: data.token };
}

export async function getPortfolioMediaUrl(
    storagePath: string
): Promise<string> {
    const supabase = createServiceClient();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60 * 60); // 1hr TTL

    if (error || !data) {
        throw new Error(`Failed to get media URL: ${error?.message}`);
    }

    return data.signedUrl;
}

export async function deletePortfolioMedia(
    storagePath: string
): Promise<void> {
    const supabase = createServiceClient();

    const { error } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);

    if (error) {
        console.error("[portfolio-media] Delete error:", error.message);
    }
}
