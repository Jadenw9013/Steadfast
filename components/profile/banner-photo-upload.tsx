"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { confirmBannerPhoto, removeBannerPhoto } from "@/app/actions/profile-photo";

export function BannerPhotoUpload({
    currentBannerUrl,
}: {
    currentBannerUrl?: string | null;
}) {
    const [bannerUrl, setBannerUrl] = useState(currentBannerUrl || null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

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
            const urlRes = await fetch("/api/profile-photo/upload-url?type=banner", { method: "POST" });
            if (!urlRes.ok) {
                const body = await urlRes.json().catch(() => ({}));
                throw new Error(body.error || "Failed to get upload URL");
            }
            const { signedUrl, token, storagePath } = await urlRes.json();

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

            await confirmBannerPhoto(storagePath);

            const objectUrl = URL.createObjectURL(file);
            setBannerUrl(objectUrl);
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
            await removeBannerPhoto();
            setBannerUrl(null);
        } catch {
            setError("Failed to remove banner.");
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
                id="banner-photo-input"
            />

            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="group relative block h-32 w-full overflow-hidden rounded-2xl transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-60 sm:h-40"
                aria-label="Upload banner photo"
            >
                {bannerUrl ? (
                    <Image
                        src={bannerUrl}
                        alt="Profile banner"
                        fill
                        className="object-cover"
                    />
                ) : (
                    <div className="h-full w-full bg-gradient-to-br from-zinc-800 via-zinc-700 to-indigo-900" />
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    {uploading ? (
                        <svg className="h-6 w-6 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                    ) : (
                        <span className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                <circle cx="12" cy="13" r="4" />
                            </svg>
                            {bannerUrl ? "Change Banner" : "Add Banner"}
                        </span>
                    )}
                </div>
            </button>

            {/* Remove button */}
            {bannerUrl && !uploading && (
                <button
                    type="button"
                    onClick={handleRemove}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-red-600/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label="Remove banner photo"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
