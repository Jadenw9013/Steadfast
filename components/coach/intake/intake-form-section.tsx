"use client";

import { useState, useEffect, useCallback } from "react";
import {
    DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext, sortableKeyboardCoordinates, useSortable,
    verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveIntakeFormTemplate } from "@/app/actions/intake-form";
import type { IntakeFormSection, IntakeFormQuestion } from "@/lib/intake-form-defaults";

type Props = {
    initialSections: IntakeFormSection[] | null;
    onCreated?: () => void;
};

function genId() {
    return "q_" + Math.random().toString(36).slice(2, 10);
}

function genSectionId() {
    return "sec_" + Math.random().toString(36).slice(2, 10);
}

// ---- Sortable question row ----
function SortableQuestion({
    q, onUpdate, onDelete,
}: {
    q: IntakeFormQuestion;
    onUpdate: (updated: IntakeFormQuestion) => void;
    onDelete: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
    const [showExtra, setShowExtra] = useState(!!q.placeholder || !!q.helperText);

    return (
        <div ref={setNodeRef} style={style} className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 space-y-3">
            <div className="flex items-start gap-3">
                <button {...attributes} {...listeners} className="mt-1 cursor-grab text-zinc-600 hover:text-zinc-400 min-h-[48px] min-w-[24px] flex items-center" aria-label="Drag to reorder" type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
                </button>
                <div className="flex-1 space-y-2">
                    <label className="sr-only" htmlFor={`ql-${q.id}`}>Question label</label>
                    <input
                        id={`ql-${q.id}`}
                        value={q.label}
                        onChange={(e) => onUpdate({ ...q, label: e.target.value })}
                        className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none border-b border-transparent focus:border-blue-500/50 py-1"
                        style={{ fontSize: "max(1rem, 16px)" }}
                        placeholder="Question text..."
                        aria-label={`Edit question label`}
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                        <select
                            value={q.type}
                            onChange={(e) => onUpdate({ ...q, type: e.target.value as "short_text" | "long_text" })}
                            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 min-h-[36px]"
                        >
                            <option value="short_text">Short Text</option>
                            <option value="long_text">Long Text</option>
                        </select>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-500">
                            <input
                                type="checkbox"
                                checked={q.required}
                                onChange={(e) => onUpdate({ ...q, required: e.target.checked })}
                                className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-500"
                                aria-checked={q.required}
                            />
                            Required
                        </label>
                        <button onClick={() => setShowExtra(!showExtra)} className="text-xs text-zinc-600 hover:text-zinc-400" type="button">
                            {showExtra ? "Hide options" : "More options"}
                        </button>
                    </div>
                    {showExtra && (
                        <div className="space-y-2 pl-0">
                            <div>
                                <label htmlFor={`qp-${q.id}`} className="text-xs text-zinc-600 block mb-1">Placeholder</label>
                                <input id={`qp-${q.id}`} value={q.placeholder ?? ""} onChange={(e) => onUpdate({ ...q, placeholder: e.target.value || undefined })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 placeholder-zinc-600" style={{ fontSize: "max(1rem, 16px)" }} placeholder="Placeholder text..." />
                            </div>
                            <div>
                                <label htmlFor={`qh-${q.id}`} className="text-xs text-zinc-600 block mb-1">Helper text</label>
                                <input id={`qh-${q.id}`} value={q.helperText ?? ""} onChange={(e) => onUpdate({ ...q, helperText: e.target.value || undefined })} className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 placeholder-zinc-600" style={{ fontSize: "max(1rem, 16px)" }} placeholder="Helper text shown below field..." />
                            </div>
                        </div>
                    )}
                </div>
                <button onClick={onDelete} className="text-zinc-600 hover:text-red-400 min-h-[48px] min-w-[24px] flex items-center" aria-label="Delete question" type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
            </div>
        </div>
    );
}

// ---- Sortable section card ----
function SortableSectionCard({
    section, onUpdate, onDelete, onAddQuestion, onUpdateQuestion, onDeleteQuestion, onReorderQuestions,
}: {
    section: IntakeFormSection;
    onUpdate: (s: IntakeFormSection) => void;
    onDelete: () => void;
    onAddQuestion: () => void;
    onUpdateQuestion: (qId: string, q: IntakeFormQuestion) => void;
    onDeleteQuestion: (qId: string) => void;
    onReorderQuestions: (oldIndex: number, newIndex: number) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleQuestionDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIdx = section.questions.findIndex((q) => q.id === active.id);
            const newIdx = section.questions.findIndex((q) => q.id === over.id);
            onReorderQuestions(oldIdx, newIdx);
        }
    };

    return (
        <div ref={setNodeRef} style={style} className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 space-y-4">
            <div className="flex items-start gap-3">
                <button {...attributes} {...listeners} className="mt-1 cursor-grab text-zinc-600 hover:text-zinc-400 min-h-[48px] min-w-[24px] flex items-center" aria-label="Drag to reorder section" type="button">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
                </button>
                <div className="flex-1">
                    <label className="sr-only" htmlFor={`st-${section.id}`}>Section title</label>
                    <input
                        id={`st-${section.id}`}
                        value={section.title}
                        onChange={(e) => onUpdate({ ...section, title: e.target.value })}
                        className="w-full bg-transparent text-lg font-bold text-zinc-200 placeholder-zinc-600 focus:outline-none border-b border-transparent focus:border-blue-500/50 py-1"
                        style={{ fontSize: "max(1rem, 16px)" }}
                        placeholder="Section title..."
                        aria-label="Edit section title"
                    />
                    <input
                        value={section.description ?? ""}
                        onChange={(e) => onUpdate({ ...section, description: e.target.value || undefined })}
                        className="w-full bg-transparent text-sm text-zinc-500 placeholder-zinc-700 focus:outline-none border-b border-transparent focus:border-blue-500/50 py-1 mt-1"
                        style={{ fontSize: "max(1rem, 16px)" }}
                        placeholder="Section description (optional)..."
                    />
                </div>
                <button onClick={onDelete} className="text-zinc-600 hover:text-red-400 min-h-[48px] min-w-[24px] flex items-center" aria-label="Delete section" type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleQuestionDragEnd}>
                <SortableContext items={section.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {section.questions.map((q) => (
                            <SortableQuestion
                                key={q.id}
                                q={q}
                                onUpdate={(updated) => onUpdateQuestion(q.id, updated)}
                                onDelete={() => onDeleteQuestion(q.id)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            <button onClick={onAddQuestion} className="w-full rounded-xl border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-600 hover:text-zinc-400 hover:border-zinc-500 transition-all min-h-[48px]" type="button">
                + Add Question
            </button>
        </div>
    );
}

// ---- Main component ----
export function IntakeFormSectionPanel({ initialSections, onCreated }: Props) {
    const [mode, setMode] = useState<"preview" | "edit">("preview");
    const [sections, setSections] = useState<IntakeFormSection[]>(initialSections ?? []);
    const [savedSections, setSavedSections] = useState<IntakeFormSection[]>(initialSections ?? []);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        setHasChanges(JSON.stringify(sections) !== JSON.stringify(savedSections));
    }, [sections, savedSections]);

    // Warn before leaving with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (hasChanges && mode === "edit") {
                e.preventDefault();
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasChanges, mode]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleSectionDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setSections((prev) => {
                const oldIdx = prev.findIndex((s) => s.id === active.id);
                const newIdx = prev.findIndex((s) => s.id === over.id);
                return arrayMove(prev, oldIdx, newIdx);
            });
        }
    };

    const updateSection = useCallback((sectionId: string, updated: IntakeFormSection) => {
        setSections((prev) => prev.map((s) => (s.id === sectionId ? updated : s)));
    }, []);

    const deleteSection = useCallback((sectionId: string) => {
        setSections((prev) => prev.filter((s) => s.id !== sectionId));
    }, []);

    const addQuestion = useCallback((sectionId: string) => {
        setSections((prev) => prev.map((s) => s.id === sectionId ? {
            ...s, questions: [...s.questions, { id: genId(), label: "", type: "short_text" as const, required: false }],
        } : s));
    }, []);

    const updateQuestion = useCallback((sectionId: string, qId: string, updated: IntakeFormQuestion) => {
        setSections((prev) => prev.map((s) => s.id === sectionId ? {
            ...s, questions: s.questions.map((q) => (q.id === qId ? updated : q)),
        } : s));
    }, []);

    const deleteQuestion = useCallback((sectionId: string, qId: string) => {
        setSections((prev) => prev.map((s) => s.id === sectionId ? {
            ...s, questions: s.questions.filter((q) => q.id !== qId),
        } : s));
    }, []);

    const reorderQuestions = useCallback((sectionId: string, oldIdx: number, newIdx: number) => {
        setSections((prev) => prev.map((s) => s.id === sectionId ? {
            ...s, questions: arrayMove(s.questions, oldIdx, newIdx),
        } : s));
    }, []);

    const addSection = () => {
        setSections((prev) => [...prev, { id: genSectionId(), title: "", questions: [{ id: genId(), label: "", type: "short_text", required: false }] }]);
    };

    const handleSave = async () => {
        setError(null);
        setSaving(true);
        try {
            const result = await saveIntakeFormTemplate({ sections });
            if (result.success) {
                setSavedSections(sections);
                setMode("preview");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save.");
        }
        setSaving(false);
    };

    const handleCancel = () => {
        setSections(savedSections);
        setMode("preview");
        setError(null);
    };

    // No template yet — show setup button
    if (!initialSections && mode === "preview") {
        return (
            <div className="text-center py-6 space-y-3">
                <p className="text-sm text-zinc-500">No intake form configured yet.</p>
                <button
                    onClick={() => {
                        import("@/lib/intake-form-defaults").then(({ DEFAULT_INTAKE_FORM_SECTIONS }) => {
                            setSections(DEFAULT_INTAKE_FORM_SECTIONS);
                            setSavedSections(DEFAULT_INTAKE_FORM_SECTIONS);
                            setMode("edit");
                            onCreated?.();
                        });
                    }}
                    className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-all min-h-[48px]"
                >
                    Get Started
                </button>
            </div>
        );
    }

    // Preview mode
    if (mode === "preview") {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <p className="text-sm text-zinc-400">{sections.length} section{sections.length !== 1 ? "s" : ""}, {sections.reduce((t, s) => t + s.questions.length, 0)} questions</p>
                    <button onClick={() => setMode("edit")} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-all min-h-[48px]">
                        Edit Form
                    </button>
                </div>
                {sections.map((section) => (
                    <div key={section.id} className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-zinc-300">{section.title}</h3>
                            <span className="text-xs text-zinc-600">{section.questions.length} question{section.questions.length !== 1 ? "s" : ""}</span>
                        </div>
                        {section.description && <p className="text-xs text-zinc-600">{section.description}</p>}
                        <div className="space-y-1">
                            {section.questions.map((q) => (
                                <div key={q.id} className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                                    <span className="flex-1 text-zinc-400">{q.label}{q.required ? " *" : ""}</span>
                                    <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-600">{q.type === "short_text" ? "Short" : "Long"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // Edit mode
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-zinc-300">Edit Intake Form</h3>
                    {hasChanges && <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400">Unsaved changes</span>}
                </div>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-4">
                        {sections.map((section) => (
                            <SortableSectionCard
                                key={section.id}
                                section={section}
                                onUpdate={(s) => updateSection(section.id, s)}
                                onDelete={() => deleteSection(section.id)}
                                onAddQuestion={() => addQuestion(section.id)}
                                onUpdateQuestion={(qId, q) => updateQuestion(section.id, qId, q)}
                                onDeleteQuestion={(qId) => deleteQuestion(section.id, qId)}
                                onReorderQuestions={(o, n) => reorderQuestions(section.id, o, n)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            <button onClick={addSection} className="w-full rounded-xl border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-600 hover:text-zinc-400 hover:border-zinc-500 transition-all min-h-[48px]" type="button">
                + Add Section
            </button>

            {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>}

            <div className="flex items-center gap-3">
                <button onClick={handleSave} disabled={saving || !hasChanges} className="flex-1 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[48px]">
                    {saving ? "Saving..." : "Save Form"}
                </button>
                <button onClick={handleCancel} className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all min-h-[48px]">
                    Cancel
                </button>
            </div>
        </div>
    );
}
