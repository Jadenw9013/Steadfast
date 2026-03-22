import { createServiceClient } from "./server";

const BUCKET = "coach-documents";

function isBucketMissing(message: string | undefined): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    return (
        lower.includes("bucket not found") ||
        lower.includes("does not exist") ||
        (lower.includes("not found") && lower.includes("bucket"))
    );
}

export async function uploadCoachDocument(
    storagePath: string,
    file: Buffer,
    contentType: string
): Promise<void> {
    const supabase = createServiceClient();

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, { contentType, upsert: true });

    if (error) {
        if (isBucketMissing(error.message)) {
            throw new Error(
                `Storage bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage → New bucket → "${BUCKET}" (private).`
            );
        }
        throw new Error(`Failed to upload document: ${error.message}`);
    }
}

export async function getDocumentUrl(storagePath: string): Promise<string> {
    const supabase = createServiceClient();

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60 * 60); // 1hr TTL

    if (error || !data) {
        throw new Error(`Failed to get document URL: ${error?.message}`);
    }

    return data.signedUrl;
}

export async function deleteCoachDocumentFile(storagePath: string): Promise<void> {
    const supabase = createServiceClient();

    const { error } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);

    if (error) {
        console.error("[coach-documents] Delete error:", error.message);
    }
}
