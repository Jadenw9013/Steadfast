"use client";

import { useState, useRef } from "react";
import { createTestimonial, updateTestimonial } from "@/app/actions/testimonials";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface TestimonialFormProps {
    coachId: string;
    coachName: string;
    existingTestimonial?: {
        id: string;
        rating: number;
        reviewText: string | null;
        anonymous: boolean;
        images: string[];
    } | null;
}

interface UploadedImage {
    storagePath: string;
    previewUrl: string;
}

export function TestimonialForm({ coachId, coachName, existingTestimonial }: TestimonialFormProps) {
    const router = useRouter();
    const isEditing = !!existingTestimonial;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [rating, setRating] = useState(existingTestimonial?.rating ?? 0);
    const [hoverRating, setHoverRating] = useState(0);
    const [reviewText, setReviewText] = useState(existingTestimonial?.reviewText ?? "");
    const [anonymous, setAnonymous] = useState(existingTestimonial?.anonymous ?? false);
    const [images, setImages] = useState<UploadedImage[]>(
        (existingTestimonial?.images ?? []).map((path) => ({
            storagePath: path,
            previewUrl: "", // Existing images won't have preview URLs
        }))
    );
    const [isUploading, setIsUploading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const remaining = 4 - images.length;
        if (remaining <= 0) {
            setMessage({ type: "error", text: "Maximum 4 images allowed." });
            return;
        }

        const filesToUpload = Array.from(files).slice(0, remaining);
        setIsUploading(true);
        setMessage(null);

        try {
            for (const file of filesToUpload) {
                // Validate client-side
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                    setMessage({ type: "error", text: `${file.name}: Only JPEG, PNG, and WebP images are allowed.` });
                    continue;
                }
                if (file.size > 5 * 1024 * 1024) {
                    setMessage({ type: "error", text: `${file.name}: Image must be under 5MB.` });
                    continue;
                }

                // Get signed upload URL
                const res = await fetch("/api/testimonial-image-upload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                    }),
                });

                if (!res.ok) {
                    const data = await res.json();
                    setMessage({ type: "error", text: data.error || "Upload failed." });
                    continue;
                }

                const { signedUrl, token, storagePath } = await res.json();

                // Upload to Supabase
                const uploadRes = await fetch(signedUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Type": file.type,
                        "x-upsert": "true",
                    },
                    body: file,
                });

                if (!uploadRes.ok) {
                    setMessage({ type: "error", text: `Failed to upload ${file.name}.` });
                    continue;
                }

                // Create local preview
                const previewUrl = URL.createObjectURL(file);
                setImages((prev) => [...prev, { storagePath, previewUrl }]);
            }
        } catch {
            setMessage({ type: "error", text: "Image upload failed." });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    function removeImage(index: number) {
        setImages((prev) => prev.filter((_, i) => i !== index));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (rating === 0) {
            setMessage({ type: "error", text: "Please select a rating." });
            return;
        }

        setIsSubmitting(true);
        setMessage(null);

        const imagePaths = images.map((img) => img.storagePath);

        try {
            if (isEditing) {
                await updateTestimonial({
                    testimonialId: existingTestimonial!.id,
                    rating,
                    reviewText,
                    anonymous,
                    images: imagePaths,
                });
                setMessage({ type: "success", text: "Review updated successfully!" });
            } else {
                await createTestimonial({
                    coachId,
                    rating,
                    reviewText,
                    anonymous,
                    images: imagePaths,
                });
                setMessage({ type: "success", text: "Review submitted successfully!" });
            }
            setTimeout(() => router.push("/client"), 1500);
        } catch (err: unknown) {
            setMessage({
                type: "error",
                text: err instanceof Error ? err.message : "Failed to submit review.",
            });
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {message && (
                <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
                    message.type === "success"
                        ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                }`}>
                    {message.text}
                </div>
            )}

            {/* Star Rating */}
            <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Rating
                </label>
                <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <button
                            key={star}
                            type="button"
                            onClick={() => setRating(star)}
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(0)}
                            className="p-0.5 transition-transform hover:scale-110"
                            aria-label={`Rate ${star} stars`}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="32"
                                height="32"
                                viewBox="0 0 24 24"
                                fill={(hoverRating || rating) >= star ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.5"
                                className={`transition-colors ${
                                    (hoverRating || rating) >= star
                                        ? "text-amber-400"
                                        : "text-zinc-300 dark:text-zinc-600"
                                }`}
                            >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        </button>
                    ))}
                </div>
            </div>

            {/* Review Text — optional */}
            <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Your Review <span className="font-normal text-zinc-400">(optional)</span>
                </label>
                <textarea
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    rows={5}
                    className="block w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm leading-relaxed focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                    placeholder={`Share your experience working with ${coachName}... (leave blank to submit a star-only rating)`}
                    maxLength={2000}
                />
                <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    {reviewText.length}/2000 characters
                </p>
            </div>

            {/* Anonymous toggle */}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="relative mt-0.5 shrink-0">
                    <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={anonymous}
                        onChange={(e) => setAnonymous(e.target.checked)}
                        id="anonymous-toggle"
                    />
                    <div className="h-5 w-5 rounded border-2 border-zinc-300 bg-white transition-colors peer-checked:border-blue-500 peer-checked:bg-blue-500 dark:border-zinc-600 dark:bg-zinc-700">
                        {anonymous && (
                            <svg className="ml-0.5 mt-0.5 h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </div>
                </div>
                <div>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Submit anonymously</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Your name won&apos;t appear on the coach&apos;s public profile. Your review is still verified.</p>
                </div>
            </label>

            {/* Image Upload */}
            <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Photos <span className="font-normal text-zinc-400">(optional, up to 4)</span>
                </label>

                {/* Image Preview Grid */}
                {images.length > 0 && (
                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {images.map((img, i) => (
                            <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                                {img.previewUrl ? (
                                    <Image
                                        src={img.previewUrl}
                                        alt={`Upload ${i + 1}`}
                                        fill
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                                        Image {i + 1}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeImage(i)}
                                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                    aria-label={`Remove image ${i + 1}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {images.length < 4 && (
                    <div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            onChange={handleImageUpload}
                            className="hidden"
                            id="testimonial-images"
                        />
                        <label
                            htmlFor="testimonial-images"
                            className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50 ${
                                isUploading ? "opacity-50 pointer-events-none" : "text-zinc-500 dark:text-zinc-400"
                            }`}
                        >
                            {isUploading ? (
                                <>
                                    <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                                    Add Photos
                                </>
                            )}
                        </label>
                        <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                            JPEG, PNG, or WebP · Max 5MB each
                        </p>
                    </div>
                )}
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="rounded-xl px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={isSubmitting || rating === 0}
                    className="rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                    {isSubmitting ? "Submitting..." : isEditing ? "Update Review" : "Submit Review"}
                </button>
            </div>
        </form>
    );
}
