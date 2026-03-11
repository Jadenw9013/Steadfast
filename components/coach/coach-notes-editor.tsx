"use client";

import { useState } from "react";
import { saveCoachNotes } from "@/app/actions/coach-notes";

export function CoachNotesEditor({
  clientId,
  initial,
}: {
  clientId: string;
  initial: string;
}) {
  const [notes, setNotes] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await saveCoachNotes({ clientId, notes });
      setSaved(true);
    } catch (err) {
      console.error("Failed to save notes:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-2 text-sm font-semibold">Coach Notes</h3>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="Private notes about this client..."
        aria-label="Coach notes"
        className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save Notes"}
      </button>
    </div>
  );
}
