"use client";

import { useState, useTransition } from "react";
import { saveCoachDocument, deleteCoachDocument, toggleDocumentActive, updateDocumentOrder } from "@/app/actions/coach-documents";

const STARTER_DOCS = [
    {
        title: "Liability Waiver",
        content: `ASSUMPTION OF RISK AND LIABILITY WAIVER

I, [Client Name], acknowledge that fitness training involves physical activity that may carry inherent risks, including but not limited to physical injury.

I voluntarily choose to participate in a coaching program with [Coach Name] and assume all risks associated with this activity.

I agree that [Coach Name] shall not be liable for any injury, loss, or damage arising from my participation in this program, provided that such injury is not caused by gross negligence or intentional misconduct.

I confirm that I am in adequate physical condition to participate in a fitness program and that I have disclosed any known medical conditions to my coach.

By signing below, I agree to these terms.`,
    },
    {
        title: "Photo & Video Consent",
        content: `PHOTO AND VIDEO CONSENT

I, [Client Name], give permission to [Coach Name] to take photographs and/or videos of me for the purpose of tracking my fitness progress.

I understand these images may be used for:
• Personal coaching records and progress tracking
• With my explicit written permission: promotional or social media use

I retain the right to withdraw this consent at any time by notifying my coach in writing.

By signing below, I agree to these terms.`,
    },
];

type Doc = {
    id: string;
    title: string;
    type: string;
    content: string | null;
    fileName: string | null;
    fileType: string | null;
    isActive: boolean;
    sortOrder: number;
};

export function DocumentLibrary({ initialDocuments }: { initialDocuments: Doc[] }) {
    const [docs, setDocs] = useState<Doc[]>(initialDocuments);
    const [pending, startTransition] = useTransition();
    const [mode, setMode] = useState<"list" | "text" | "upload">("list");
    const [editId, setEditId] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const handleSaveText = () => {
        if (!title.trim()) { setError("Title is required."); return; }
        setError(null);
        startTransition(async () => {
            const res = await saveCoachDocument({ id: editId ?? undefined, title, type: "TEXT", content });
            if (res.success) {
                setMode("list");
                setEditId(null);
                setTitle("");
                setContent("");
                // Optimistic: refresh will revalidate
                if (!editId && res.id) {
                    setDocs(prev => [...prev, { id: res.id!, title: title.trim(), type: "TEXT", content, fileName: null, fileType: null, isActive: true, sortOrder: prev.length }]);
                } else {
                    setDocs(prev => prev.map(d => d.id === editId ? { ...d, title: title.trim(), content } : d));
                }
            } else {
                setError((res as { error?: string }).error ?? "Failed to save.");
            }
        });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) { setError("File must be under 10MB."); return; }

        const allowed = [".pdf", ".doc", ".docx"];
        const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
        if (!allowed.includes(ext)) { setError("Only PDF, DOC, and DOCX files are supported."); return; }

        setError(null);
        const defaultTitle = file.name.replace(/\.[^/.]+$/, "");
        const fileTitle = prompt("Document title:", defaultTitle);
        if (!fileTitle) return;

        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        startTransition(async () => {
            const res = await saveCoachDocument({
                title: fileTitle,
                type: "FILE",
                fileData: base64,
                fileType: file.type,
                fileName: file.name,
            });
            if (res.success && res.id) {
                setDocs(prev => [...prev, { id: res.id!, title: fileTitle, type: "FILE", content: null, fileName: file.name, fileType: file.type, isActive: true, sortOrder: prev.length }]);
                setMode("list");
            } else {
                setError("Failed to upload.");
            }
        });
    };

    const handleDelete = (id: string) => {
        startTransition(async () => {
            await deleteCoachDocument(id);
            setDocs(prev => prev.filter(d => d.id !== id));
            setDeleteConfirm(null);
        });
    };

    const handleToggle = (id: string) => {
        startTransition(async () => {
            const res = await toggleDocumentActive(id);
            if (res.success) {
                setDocs(prev => prev.map(d => d.id === id ? { ...d, isActive: res.isActive } : d));
            }
        });
    };

    const openStarter = (starter: typeof STARTER_DOCS[0]) => {
        setTitle(starter.title);
        setContent(starter.content);
        setEditId(null);
        setMode("text");
    };

    const openEdit = (doc: Doc) => {
        setTitle(doc.title);
        setContent(doc.content ?? "");
        setEditId(doc.id);
        setMode("text");
    };

    const typeBadge = (doc: Doc) => {
        if (doc.type === "FILE") {
            const ext = doc.fileName?.split(".").pop()?.toUpperCase() ?? "FILE";
            return <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">{ext}</span>;
        }
        return <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-400">Text</span>;
    };

    // Text editor mode
    if (mode === "text") {
        return (
            <div className="space-y-4">
                <div>
                    <label htmlFor="doc-title" className="mb-1.5 block text-xs font-medium text-zinc-400">Title *</label>
                    <input
                        id="doc-title"
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="e.g. Liability Waiver"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
                        style={{ minHeight: "48px" }}
                    />
                </div>
                <div>
                    <label htmlFor="doc-content" className="mb-1.5 block text-xs font-medium text-zinc-400">Content</label>
                    <textarea
                        id="doc-content"
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        placeholder="Write or paste your document content..."
                        rows={10}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none font-mono resize-y"
                        style={{ minHeight: "200px" }}
                    />
                </div>
                {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
                <div className="flex gap-2">
                    <button
                        disabled={pending}
                        onClick={handleSaveText}
                        className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-all"
                        style={{ minHeight: "48px" }}
                    >
                        {pending ? "Saving..." : editId ? "Update Document" : "Save Document"}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setMode("list"); setEditId(null); setError(null); }}
                        className="px-5 py-3 text-sm text-zinc-500 hover:text-zinc-300"
                        style={{ minHeight: "48px" }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    // List mode
    return (
        <div className="space-y-4">
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

            {docs.length === 0 && (
                <div className="space-y-4">
                    <p className="text-sm text-zinc-500">Add waivers, consent forms, or any documents your clients need to read and sign before starting.</p>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-4">Start with a template</p>
                    <div className="flex flex-wrap gap-2">
                        {STARTER_DOCS.map(s => (
                            <button
                                key={s.title}
                                onClick={() => openStarter(s)}
                                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 hover:border-blue-500/30 hover:text-blue-400 transition-all"
                                style={{ minHeight: "48px" }}
                            >
                                + {s.title}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {docs.map(doc => (
                <div key={doc.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${doc.isActive ? "border-white/[0.06] bg-zinc-900/40" : "border-zinc-800 bg-zinc-900/20 opacity-60"}`}>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-zinc-200 truncate">{doc.title}</p>
                            {typeBadge(doc)}
                            {!doc.isActive && <span className="text-[10px] text-zinc-600 font-semibold">INACTIVE</span>}
                        </div>
                        {doc.fileName && <p className="text-xs text-zinc-600 truncate mt-0.5">{doc.fileName}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            onClick={() => handleToggle(doc.id)}
                            disabled={pending}
                            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                            title={doc.isActive ? "Deactivate" : "Activate"}
                            style={{ minHeight: "40px", minWidth: "40px" }}
                        >
                            {doc.isActive ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                            )}
                        </button>
                        {doc.type === "TEXT" && (
                            <button
                                onClick={() => openEdit(doc)}
                                disabled={pending}
                                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                                title="Edit"
                                style={{ minHeight: "40px", minWidth: "40px" }}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                            </button>
                        )}
                        {deleteConfirm === doc.id ? (
                            <div className="flex items-center gap-1">
                                <button onClick={() => handleDelete(doc.id)} disabled={pending} className="rounded-lg bg-red-500/20 p-2 text-red-400 hover:bg-red-500/30 transition-colors" style={{ minHeight: "40px", minWidth: "40px" }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                </button>
                                <button onClick={() => setDeleteConfirm(null)} className="rounded-lg p-2 text-zinc-500 hover:text-zinc-300 transition-colors" style={{ minHeight: "40px", minWidth: "40px" }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setDeleteConfirm(doc.id)}
                                disabled={pending}
                                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                                title="Delete"
                                style={{ minHeight: "40px", minWidth: "40px" }}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                            </button>
                        )}
                    </div>
                </div>
            ))}

            {/* Add buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
                <label className="cursor-pointer rounded-xl border border-dashed border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-400 hover:border-blue-500/30 hover:text-blue-400 transition-all" style={{ minHeight: "48px" }}>
                    <input type="file" accept=".pdf,.doc,.docx" onChange={handleFileUpload} className="sr-only" />
                    Upload a File
                </label>
                <button
                    onClick={() => { setTitle(""); setContent(""); setEditId(null); setMode("text"); setError(null); }}
                    className="rounded-xl border border-dashed border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-400 hover:border-violet-500/30 hover:text-violet-400 transition-all"
                    style={{ minHeight: "48px" }}
                >
                    Write a Document
                </button>
            </div>

            {/* Starter templates (shown when docs exist but user may want more) */}
            {docs.length > 0 && STARTER_DOCS.some(s => !docs.find(d => d.title === s.title)) && (
                <div className="border-t border-white/[0.04] pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-2">Templates</p>
                    <div className="flex flex-wrap gap-2">
                        {STARTER_DOCS.filter(s => !docs.find(d => d.title === s.title)).map(s => (
                            <button
                                key={s.title}
                                onClick={() => openStarter(s)}
                                className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
                            >
                                + {s.title}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
