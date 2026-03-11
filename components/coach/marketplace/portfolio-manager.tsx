"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import {
    createPortfolioItem,
    updatePortfolioItem,
    deletePortfolioItem,
    removePortfolioItemMedia,
} from "@/app/actions/marketplace";

type PortfolioItemType = {
    id: string;
    title: string;
    result: string | null;
    description: string | null;
    category: string | null;
    mediaPath: string | null;
    mediaType: string | null;
    mediaUrl: string | null;
    sortOrder: number;
    createdAt: Date;
};

type FormState = {
    title: string;
    description: string;
    category: string;
    mediaPath: string | null;
    mediaType: string | null;
};

const emptyForm: FormState = {
    title: "",
    description: "",
    category: "",
    mediaPath: null,
    mediaType: null,
};

const TAG_SUGGESTIONS = ["Transformation", "Tip", "Milestone", "Training", "Nutrition"];

function formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "just now";
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d`;
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 4) return `${diffWeeks}w`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo`;
}

export function PortfolioManager({ items: initialItems }: { items: PortfolioItemType[] }) {
    const [items, setItems] = useState(initialItems);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showCompose, setShowCompose] = useState(false);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showTagPicker, setShowTagPicker] = useState(false);

    // Image upload state
    const [uploading, setUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const charCount = form.title.length + form.description.length;
    const MAX_CHARS = 500;
    const charRatio = Math.min(charCount / MAX_CHARS, 1);

    function openCompose() {
        setShowCompose(true);
        setEditingId(null);
        setForm(emptyForm);
        setPreviewUrl(null);
        setError(null);
        setShowTagPicker(false);
        setTimeout(() => textareaRef.current?.focus(), 50);
    }

    function startEdit(item: PortfolioItemType) {
        setEditingId(item.id);
        setShowCompose(true);
        setForm({
            title: item.title,
            description: item.description || "",
            category: item.category || "",
            mediaPath: item.mediaPath,
            mediaType: item.mediaType,
        });
        setPreviewUrl(item.mediaUrl);
        setShowTagPicker(false);
    }

    function cancelCompose() {
        setEditingId(null);
        setShowCompose(false);
        setForm(emptyForm);
        setPreviewUrl(null);
        setError(null);
        setShowTagPicker(false);
    }

    async function handleMediaSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");

        if (!isImage && !isVideo) {
            setError("Please select an image or video file.");
            return;
        }
        if (isImage && file.size > 5 * 1024 * 1024) {
            setError("Images must be under 5MB.");
            return;
        }
        if (isVideo && file.size > 50 * 1024 * 1024) {
            setError("Videos must be under 50MB.");
            return;
        }

        setUploading(true);
        setError(null);

        try {
            const urlRes = await fetch("/api/portfolio-media/upload-url", { method: "POST" });
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

            if (!uploadRes.ok) throw new Error("Upload failed");

            setForm((f) => ({ ...f, mediaPath: storagePath, mediaType: isVideo ? "video" : "image" }));
            setPreviewUrl(URL.createObjectURL(file));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    async function handleRemoveImage() {
        if (editingId && form.mediaPath) {
            try { await removePortfolioItemMedia(editingId); } catch { /* continue */ }
        }
        setForm((f) => ({ ...f, mediaPath: null, mediaType: null }));
        setPreviewUrl(null);
    }

    async function handlePost() {
        if (!form.title.trim()) return;
        setSaving(true);
        setError(null);
        try {
            if (editingId) {
                const updated = await updatePortfolioItem({
                    id: editingId,
                    title: form.title,
                    result: null,
                    description: form.description || null,
                    category: form.category || null,
                    mediaPath: form.mediaPath,
                    mediaType: form.mediaType as "image" | "video" | null,
                });
                setItems((prev) =>
                    prev.map((i) =>
                        i.id === editingId ? { ...i, ...updated, mediaUrl: previewUrl } : i
                    )
                );
            } else {
                const created = await createPortfolioItem({
                    title: form.title,
                    result: null,
                    description: form.description || null,
                    category: form.category || null,
                    mediaPath: form.mediaPath,
                    mediaType: form.mediaType as "image" | "video" | null,
                });
                setItems((prev) => [{ ...created, mediaUrl: previewUrl }, ...prev]);
            }
            cancelCompose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to post");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        setSaving(true);
        try {
            await deletePortfolioItem(id);
            setItems((prev) => prev.filter((i) => i.id !== id));
            if (editingId === id) cancelCompose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to delete");
        } finally {
            setSaving(false);
        }
    }

    // ── Compose Box (Twitter-style) ──
    function renderCompose() {
        return (
            <div className="px-5 py-4">
                {error && (
                    <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                    </div>
                )}

                {/* Main textarea — "What do you want to share?" */}
                <textarea
                    ref={textareaRef}
                    value={form.title}
                    onChange={(e) => {
                        setForm((f) => ({ ...f, title: e.target.value }));
                        // Auto-resize
                        const el = e.target;
                        el.style.height = "auto";
                        el.style.height = el.scrollHeight + "px";
                    }}
                    placeholder="What do you want to share?"
                    rows={1}
                    className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    style={{ minHeight: "44px" }}
                />

                {/* Optional body/detail */}
                {(form.description || form.title.length > 0) && (
                    <textarea
                        value={form.description}
                        onChange={(e) => {
                            setForm((f) => ({ ...f, description: e.target.value }));
                            const el = e.target;
                            el.style.height = "auto";
                            el.style.height = el.scrollHeight + "px";
                        }}
                        placeholder="Add more detail..."
                        rows={1}
                        className="mt-1 w-full resize-none border-0 bg-transparent text-sm leading-relaxed text-zinc-500 placeholder:text-zinc-400 focus:outline-none focus:ring-0 dark:text-zinc-400 dark:placeholder:text-zinc-600"
                        style={{ minHeight: "32px" }}
                    />
                )}

                {/* Inline image preview */}
                {previewUrl && (
                    <div className="relative mt-3 overflow-hidden rounded-2xl">
                        {form.mediaType === "video" ? (
                            <video
                                src={previewUrl}
                                controls
                                className="w-full rounded-2xl"
                                style={{ maxHeight: "280px" }}
                            />
                        ) : (
                            <Image
                                src={previewUrl}
                                alt="Post image"
                                width={600}
                                height={400}
                                className="w-full rounded-2xl object-cover"
                                style={{ maxHeight: "280px" }}
                            />
                        )}
                        <button
                            type="button"
                            onClick={handleRemoveImage}
                            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                            aria-label="Remove image"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    </div>
                )}

                {/* Tag pill */}
                {form.category && (
                    <div className="mt-3 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                            #{form.category}
                            <button
                                type="button"
                                onClick={() => setForm((f) => ({ ...f, category: "" }))}
                                className="ml-0.5 text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300"
                                aria-label="Remove tag"
                            >
                                ×
                            </button>
                        </span>
                    </div>
                )}

                {/* ── Bottom toolbar ── */}
                <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <div className="flex items-center gap-1">
                        {/* Image button */}
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-blue-50 hover:text-blue-500 disabled:opacity-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
                            aria-label="Add image"
                        >
                            {uploading ? (
                                <svg className="h-[18px] w-[18px] animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                            )}
                        </button>

                        {/* Tag button */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowTagPicker(!showTagPicker)}
                                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${showTagPicker
                                    ? "bg-blue-50 text-blue-500 dark:bg-blue-500/10 dark:text-blue-400"
                                    : "text-zinc-400 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
                                    }`}
                                aria-label="Add tag"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" /><path d="M7 7h.01" /></svg>
                            </button>

                            {showTagPicker && (
                                <div className="absolute left-0 top-full z-10 mt-1 flex flex-wrap gap-1.5 rounded-xl border border-zinc-200/80 bg-white p-2.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                                    {TAG_SUGGESTIONS.map((tag) => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => {
                                                setForm((f) => ({ ...f, category: tag }));
                                                setShowTagPicker(false);
                                            }}
                                            className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-blue-100 hover:text-blue-600 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-500/20 dark:hover:text-blue-400"
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                    <input
                                        type="text"
                                        placeholder="Custom..."
                                        className="w-20 rounded-full border-0 bg-transparent px-2.5 py-1 text-xs text-zinc-600 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-300"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && e.currentTarget.value.trim()) {
                                                setForm((f) => ({ ...f, category: e.currentTarget.value.trim() }));
                                                setShowTagPicker(false);
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Character counter ring */}
                        {charCount > 0 && (
                            <div className="relative h-6 w-6">
                                <svg className="h-6 w-6 -rotate-90" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-200 dark:text-zinc-700" />
                                    <circle
                                        cx="12" cy="12" r="10" fill="none"
                                        stroke="currentColor" strokeWidth="2"
                                        strokeDasharray={`${charRatio * 62.83} 62.83`}
                                        strokeLinecap="round"
                                        className={charRatio > 0.9 ? "text-red-500" : charRatio > 0.75 ? "text-amber-500" : "text-blue-500"}
                                    />
                                </svg>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={cancelCompose}
                            className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={handlePost}
                            disabled={saving || !form.title.trim() || charCount > MAX_CHARS}
                            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-bold text-white transition-all hover:bg-zinc-700 disabled:opacity-40 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
                        >
                            {saving ? "Posting..." : editingId ? "Update" : "Post"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-[#0a1224]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Posts</h3>
                {!showCompose && items.length > 0 && (
                    <button
                        type="button"
                        onClick={openCompose}
                        className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-700 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
                    >
                        Post
                    </button>
                )}
            </div>

            {/* Compose area */}
            {showCompose && !editingId && (
                <div className="border-b border-zinc-100 dark:border-zinc-800">
                    {renderCompose()}
                </div>
            )}

            {/* Post feed */}
            {items.length > 0 ? (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {items.map((item) => (
                        <div key={item.id}>
                            {editingId === item.id ? (
                                renderCompose()
                            ) : (
                                <div className="group px-5 py-4">
                                    {/* Post content */}
                                    <div className="flex gap-3">
                                        <div className="flex-1 min-w-0">
                                            {/* Header row */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                                                    {item.title}
                                                </span>
                                                {item.category && (
                                                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                                                        #{item.category}
                                                    </span>
                                                )}
                                                <span className="text-xs text-zinc-400">·</span>
                                                <span className="text-xs text-zinc-400">
                                                    {formatTimeAgo(item.createdAt)}
                                                </span>
                                                {/* Actions — visible on hover */}
                                                <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                                    <button
                                                        type="button"
                                                        onClick={() => startEdit(item)}
                                                        className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                                                        aria-label="Edit"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(item.id)}
                                                        disabled={saving}
                                                        className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 disabled:opacity-50"
                                                        aria-label="Delete"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Body text */}
                                            {item.description && (
                                                <p className="mt-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                                                    {item.description}
                                                </p>
                                            )}

                                            {/* Post media */}
                                            {item.mediaUrl && (
                                                <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-700/60">
                                                    {item.mediaType === "video" ? (
                                                        <video
                                                            src={item.mediaUrl}
                                                            controls
                                                            className="w-full"
                                                            style={{ maxHeight: "300px" }}
                                                        />
                                                    ) : (
                                                        <Image
                                                            src={item.mediaUrl}
                                                            alt={item.title}
                                                            width={600}
                                                            height={400}
                                                            className="w-full object-cover"
                                                            style={{ maxHeight: "300px" }}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : !showCompose ? (
                /* Empty state */
                <div className="px-5 pb-8 pt-4">
                    <button
                        type="button"
                        onClick={openCompose}
                        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                                Share a transformation, tip, or milestone...
                            </p>
                        </div>
                    </button>
                </div>
            ) : null}

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                onChange={handleMediaSelect}
                className="hidden"
            />
        </div>
    );
}
