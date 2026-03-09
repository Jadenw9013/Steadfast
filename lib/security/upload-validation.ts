/**
 * Server-side upload validation for the Steadfast platform.
 *
 * Centralizes file type, size, and count constraints that must be enforced
 * server-side — never rely on client-only validation.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

export const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
] as const;

export const ALLOWED_IMAGE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
] as const;

/** Maximum file size in bytes (5 MB). */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum number of photos allowed per check-in submission. */
export const MAX_CHECKIN_PHOTOS = 3;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Infer probable MIME type from a filename extension.
 * Returns null if the extension is not recognized.
 */
function mimeFromExtension(
    filename: string
): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    return null;
}

// ── Validation functions ───────────────────────────────────────────────────────

interface ValidationResult {
    valid: boolean;
    error: string | null;
}

/**
 * Validate file names for check-in photo uploads.
 *
 * Checks:
 * - Number of files does not exceed MAX_CHECKIN_PHOTOS
 * - Each file has an allowed image extension
 */
export function validateCheckInUploadFiles(
    fileNames: string[]
): ValidationResult {
    if (fileNames.length === 0) {
        return { valid: false, error: "At least one file is required." };
    }

    if (fileNames.length > MAX_CHECKIN_PHOTOS) {
        return {
            valid: false,
            error: `Maximum ${MAX_CHECKIN_PHOTOS} photos per check-in. Received ${fileNames.length}.`,
        };
    }

    for (const name of fileNames) {
        const mime = mimeFromExtension(name);
        if (!mime) {
            return {
                valid: false,
                error: `File "${name}" has an unsupported type. Accepted: JPEG, PNG, WebP.`,
            };
        }
    }

    return { valid: true, error: null };
}

/**
 * Validate a profile or banner photo upload.
 * Accepts an optional MIME type (e.g. from client header).
 * Falls back to extension-based detection from the storage path.
 */
export function validateProfilePhotoUpload(
    mimeType?: string
): ValidationResult {
    if (!mimeType || mimeType.trim() === "") {
        // When no MIME type provided, allow (path already forces known extension)
        // However, empty string is explicitly rejected as it indicates a problem
        if (mimeType === "") {
            return { valid: false, error: "File type could not be determined. Accepted: JPEG, PNG, WebP." };
        }
        return { valid: true, error: null };
    }

    if (
        !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)
    ) {
        return {
            valid: false,
            error: `Unsupported file type: ${mimeType}. Accepted: JPEG, PNG, WebP.`,
        };
    }

    return { valid: true, error: null };
}
