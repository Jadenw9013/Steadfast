export function TrainingProgramActions({
  isPublished,
  saving,
  publishing,
  onSave,
  onPublish,
}: {
  isPublished: boolean;
  saving: boolean;
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || publishing}
        className="flex-1 rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {saving ? "Saving…" : "Save Draft"}
      </button>
      <button
        type="button"
        onClick={onPublish}
        disabled={saving || publishing}
        className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
      >
        {publishing ? "Publishing…" : isPublished ? "Republish" : "Publish"}
      </button>
    </div>
  );
}
