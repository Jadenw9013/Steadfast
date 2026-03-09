"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { confirmProfilePhoto, removeProfilePhoto } from "@/app/actions/profile-photo";

export function ProfilePhotoUpload({
    currentPhotoUrl,
    initials,
    size = "lg",
}: {
    currentPhotoUrl?: string | null;
    initials: string;
    size?: "sm" | "lg";
}) {
    const [photoUrl, setPhotoUrl] = useState(currentPhotoUrl || null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const dimension = size === "lg" ? "h-24 w-24" : "h-10 w-10";
    const textSize = size === "lg" ? "text-3xl" : "text-sm";

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate
        if (!file.type.startsWith("image/")) {
            setError("Please select an image file.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError("Image must be under 5MB.");
            return;
        }

        setUploading(true);
        setError(null);

        try {
            // 1. Get signed upload URL (pass mimeType for server validation)
            const urlRes = await fetch(
                `/api/profile-photo/upload-url?mimeType=${encodeURIComponent(file.type)}`,
                { method: "POST" }
            );
            if (!urlRes.ok) {
                const body = await urlRes.json().catch(() => ({}));
                throw new Error(body.error || "Failed to get upload URL");
            }
            const { signedUrl, token, storagePath } = await urlRes.json();

            // 2. Upload to Supabase
            const uploadRes = await fetch(signedUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type,
                    ...(token ? { "x-upsert": "true" } : {}),
                },
                body: file,
            });

            if (!uploadRes.ok) {
                throw new Error("Upload failed");
            }

            // 3. Confirm in DB
            await confirmProfilePhoto(storagePath);

            // 4. Show preview immediately
            const objectUrl = URL.createObjectURL(file);
            setPhotoUrl(objectUrl);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    }

    async function handleRemove() {
        setUploading(true);
        setError(null);
        try {
            await removeProfilePhoto();
            setPhotoUrl(null);
        } catch {
            setError("Failed to remove photo.");
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="relative group">
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
                id="profile-photo-input"
            />

            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className={`${dimension} relative shrink-0 overflow-hidden rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-60`}
                aria-label="Change profile photo"
            >
                {photoUrl ? (
                    <Image
                        src={photoUrl}
                        alt="Profile photo"
                        fill
                        className="object-cover"
                    />
                ) : (
                    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 ${textSize} font-bold text-zinc-600 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-300`}>
                        {initials}
                    </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    {uploading ? (
                        <svg className="h-5 w-5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                    )}
                </div>
            </button>

            {/* Remove button */}
            {photoUrl && !uploading && size === "lg" && (
                <button
                    type="button"
                    onClick={handleRemove}
                    className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-zinc-100 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-[#09090b] dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    aria-label="Remove profile photo"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                    </svg>
                </button>
            )}

            {error && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
        </div>
    );
}
