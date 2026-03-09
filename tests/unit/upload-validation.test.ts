import { describe, it, expect } from "vitest";
import {
    validateCheckInUploadFiles,
    validateProfilePhotoUpload,
    ALLOWED_IMAGE_TYPES,
    MAX_CHECKIN_PHOTOS,
    MAX_IMAGE_SIZE_BYTES,
} from "@/lib/security/upload-validation";

describe("upload-validation", () => {
    describe("validateCheckInUploadFiles", () => {
        it("accepts valid JPEG files", () => {
            const result = validateCheckInUploadFiles(["photo1.jpg", "photo2.jpeg"]);
            expect(result.valid).toBe(true);
            expect(result.error).toBeNull();
        });

        it("accepts valid PNG files", () => {
            const result = validateCheckInUploadFiles(["photo.png"]);
            expect(result.valid).toBe(true);
        });

        it("accepts valid WebP files", () => {
            const result = validateCheckInUploadFiles(["photo.webp"]);
            expect(result.valid).toBe(true);
        });

        it("rejects empty file list", () => {
            const result = validateCheckInUploadFiles([]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("At least one file");
        });

        it("rejects more than MAX_CHECKIN_PHOTOS files", () => {
            const files = Array.from({ length: MAX_CHECKIN_PHOTOS + 1 }, (_, i) => `photo${i}.jpg`);
            const result = validateCheckInUploadFiles(files);
            expect(result.valid).toBe(false);
            expect(result.error).toContain(`Maximum ${MAX_CHECKIN_PHOTOS}`);
        });

        it("rejects unsupported file types", () => {
            const result = validateCheckInUploadFiles(["document.pdf"]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("unsupported type");
        });

        it("rejects files without extensions", () => {
            const result = validateCheckInUploadFiles(["noextension"]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("unsupported type");
        });

        it("rejects mixed valid and invalid files", () => {
            const result = validateCheckInUploadFiles(["photo.jpg", "malware.exe"]);
            expect(result.valid).toBe(false);
            expect(result.error).toContain("unsupported type");
        });

        it("accepts exactly MAX_CHECKIN_PHOTOS files", () => {
            const files = Array.from({ length: MAX_CHECKIN_PHOTOS }, (_, i) => `photo${i}.jpg`);
            const result = validateCheckInUploadFiles(files);
            expect(result.valid).toBe(true);
        });

        // === NEW: Hardening pass 2 — spoofed extension tests ===

        it("rejects double-extension spoofing attempts", () => {
            const result = validateCheckInUploadFiles(["image.jpg.exe"]);
            expect(result.valid).toBe(false);
        });

        it("rejects .svg files (not in allowed list)", () => {
            const result = validateCheckInUploadFiles(["photo.svg"]);
            expect(result.valid).toBe(false);
        });

        it("rejects .gif files (not in allowed list)", () => {
            const result = validateCheckInUploadFiles(["animation.gif"]);
            expect(result.valid).toBe(false);
        });

        it("rejects .tiff files (not in allowed list)", () => {
            const result = validateCheckInUploadFiles(["scan.tiff"]);
            expect(result.valid).toBe(false);
        });

        it("handles case-insensitive extensions", () => {
            const result = validateCheckInUploadFiles(["PHOTO.JPG", "image.PNG"]);
            expect(result.valid).toBe(true);
        });
    });

    describe("validateProfilePhotoUpload", () => {
        it("accepts image/jpeg", () => {
            expect(validateProfilePhotoUpload("image/jpeg").valid).toBe(true);
        });

        it("accepts image/png", () => {
            expect(validateProfilePhotoUpload("image/png").valid).toBe(true);
        });

        it("accepts image/webp", () => {
            expect(validateProfilePhotoUpload("image/webp").valid).toBe(true);
        });

        it("rejects unsupported MIME types", () => {
            const result = validateProfilePhotoUpload("application/pdf");
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Unsupported file type");
        });

        it("rejects text/plain", () => {
            const result = validateProfilePhotoUpload("text/plain");
            expect(result.valid).toBe(false);
        });

        it("allows undefined mimeType (path-based fallback)", () => {
            expect(validateProfilePhotoUpload(undefined).valid).toBe(true);
        });

        // === NEW: Hardening pass 2 tests ===

        it("rejects image/svg+xml (XSS vector)", () => {
            const result = validateProfilePhotoUpload("image/svg+xml");
            expect(result.valid).toBe(false);
        });

        it("rejects image/gif", () => {
            const result = validateProfilePhotoUpload("image/gif");
            expect(result.valid).toBe(false);
        });

        it("rejects application/octet-stream", () => {
            const result = validateProfilePhotoUpload("application/octet-stream");
            expect(result.valid).toBe(false);
        });

        it("rejects empty string mimeType", () => {
            const result = validateProfilePhotoUpload("");
            expect(result.valid).toBe(false);
        });
    });

    describe("constants", () => {
        it("exports expected ALLOWED_IMAGE_TYPES", () => {
            expect(ALLOWED_IMAGE_TYPES).toContain("image/jpeg");
            expect(ALLOWED_IMAGE_TYPES).toContain("image/png");
            expect(ALLOWED_IMAGE_TYPES).toContain("image/webp");
            expect(ALLOWED_IMAGE_TYPES).toHaveLength(3);
        });

        it("MAX_CHECKIN_PHOTOS is 3", () => {
            expect(MAX_CHECKIN_PHOTOS).toBe(3);
        });

        it("MAX_IMAGE_SIZE_BYTES is 5MB", () => {
            expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
        });
    });
});
