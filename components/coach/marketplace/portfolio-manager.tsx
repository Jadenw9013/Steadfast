"use client";

import { useState } from "react";
import {
    createPortfolioItem,
    updatePortfolioItem,
    deletePortfolioItem,
} from "@/app/actions/marketplace";

type PortfolioItemType = {
    id: string;
    title: string;
    result: string | null;
    description: string | null;
    category: string | null;
    sortOrder: number;
};

type FormState = {
    title: string;
    result: string;
    description: string;
    category: string;
};

const emptyForm: FormState = { title: "", result: "", description: "", category: "" };

export function PortfolioManager({ items: initialItems }: { items: PortfolioItemType[] }) {
    const [items, setItems] = useState(initialItems);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function startEdit(item: PortfolioItemType) {
        setEditingId(item.id);
        setShowAdd(false);
        setForm({
            title: item.title,
            result: item.result || "",
            description: item.description || "",
            category: item.category || "",
        });
    }

    function cancelEdit() {
        setEditingId(null);
        setShowAdd(false);
        setForm(emptyForm);
        setError(null);
    }

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            if (editingId) {
                const updated = await updatePortfolioItem({ id: editingId, ...form });
                setItems((prev) => prev.map((i) => (i.id === editingId ? { ...i, ...updated } : i)));
            } else {
                const created = await createPortfolioItem(form);
                setItems((prev) => [...prev, created]);
            }
            cancelEdit();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        setSaving(true);
        try {
            await deletePortfolioItem(id);
            setItems((prev) => prev.filter((i) => i.id !== id));
            if (editingId === id) cancelEdit();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to delete");
        } finally {
            setSaving(false);
        }
    }

    const isFormOpen = showAdd || editingId !== null;

    return (
        <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-[#121215]">
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Portfolio &amp; Results</h3>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        Showcase your coaching results to build credibility
                    </p>
                </div>
                {!isFormOpen && (
                    <button
                        type="button"
                        onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null); }}
                        className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                        + Add Item
                    </button>
                )}
            </div>

            {error && (
                <div className="mx-6 mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            {/* Item list */}
            {items.length > 0 && (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {items.map((item) => (
                        <div key={item.id} className="px-6 py-4">
                            {editingId === item.id ? (
                                renderForm()
                            ) : (
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                                {item.title}
                                            </h4>
                                            {item.category && (
                                                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                                    {item.category}
                                                </span>
                                            )}
                                        </div>
                                        {item.result && (
                                            <p className="mt-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">{item.result}</p>
                                        )}
                                        {item.description && (
                                            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2">{item.description}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => startEdit(item)}
                                            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                                <path d="m15 5 4 4" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(item.id)}
                                            disabled={saving}
                                            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Add form */}
            {showAdd && (
                <div className="border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
                    {renderForm()}
                </div>
            )}

            {/* Empty state */}
            {items.length === 0 && !showAdd && (
                <div className="px-6 py-8 text-center">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        No portfolio items yet. Add results, transformations, or testimonials to build credibility with prospects.
                    </p>
                    <button
                        type="button"
                        onClick={() => { setShowAdd(true); setForm(emptyForm); }}
                        className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                        Add Your First Item
                    </button>
                </div>
            )}
        </div>
    );

    function renderForm() {
        return (
            <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Title *</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                            placeholder="e.g. Client Transformation"
                            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#09090b] dark:text-zinc-100"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Category</label>
                        <input
                            type="text"
                            value={form.category}
                            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                            placeholder="e.g. Weight Loss, Strength"
                            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#09090b] dark:text-zinc-100"
                        />
                    </div>
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Key Result</label>
                    <input
                        type="text"
                        value={form.result}
                        onChange={(e) => setForm((f) => ({ ...f, result: e.target.value }))}
                        placeholder="e.g. Lost 30 lbs in 12 weeks"
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#09090b] dark:text-zinc-100"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Description</label>
                    <textarea
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="Brief story about the coaching result..."
                        rows={3}
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#09090b] dark:text-zinc-100"
                    />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || !form.title.trim()}
                        className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                        {saving ? "Saving..." : editingId ? "Update" : "Add"}
                    </button>
                </div>
            </div>
        );
    }
}
