"use client";

export function MealPlanActions({
  saving,
  publishing,
  itemCount,
  isUnsaved,
  notifyClient,
  onNotifyChange,
  onSave,
  onPublish,
  canPublish,
  publicationMessage,
}: {
  saving: boolean;
  publishing: boolean;
  itemCount: number;
  isUnsaved: boolean;
  notifyClient: boolean;
  onNotifyChange: (v: boolean) => void;
  onSave: () => void;
  onPublish: () => void;
  canPublish: boolean;
  publicationMessage: string;
}) {
  return (
    <>
    <p role="status" aria-live="polite" className={`text-sm ${canPublish ? "text-amber-300" : "text-emerald-400"}`}>
      {publicationMessage}
    </p>
    <div className="flex flex-col gap-4 sf-glass-card p-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-1 block">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={notifyClient}
            onChange={(e) => onNotifyChange(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/50"
          />
          <span className="text-sm font-semibold text-zinc-200">
            Notify client by email
          </span>
        </label>
        <p className="ml-6 text-xs text-zinc-500">
          Sends an email if the client has email notifications enabled.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || publishing || !canPublish}
          className="min-h-[48px] w-full rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-2.5 text-sm font-semibold text-zinc-300 transition-all hover:bg-white/[0.06] hover:text-white disabled:opacity-50 lg:w-auto"
        >
          {saving ? "Saving..." : isUnsaved ? "Save Draft" : "Save"}
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={!canPublish || saving || publishing || itemCount === 0}
          className="min-h-[48px] w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 hover:shadow-blue-500/40 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none lg:w-auto"
        >
          {publishing ? "Publishing..." : canPublish ? "Publish" : "Published"}
        </button>
      </div>
    </div>
    </>
  );
}
