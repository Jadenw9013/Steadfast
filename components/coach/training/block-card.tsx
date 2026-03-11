"use client";

import type { TrainingBlock, BlockType } from "@/types/training";

type BlockMeta = {
  value: BlockType;
  label: string;
  borderColor: string;
  badgeColor: string;
  placeholder: string;
};

const BLOCK_META: BlockMeta[] = [
  {
    value: "EXERCISE",
    label: "Exercise",
    borderColor: "border-blue-400 dark:border-blue-500",
    badgeColor: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    placeholder: "Exercise details — sets × reps, rest periods, tempo…",
  },
  {
    value: "ACTIVATION",
    label: "Activation",
    borderColor: "border-yellow-400 dark:border-yellow-500",
    badgeColor: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
    placeholder: "Activation / warm-up exercises and cues…",
  },
  {
    value: "SUPERSET",
    label: "Superset",
    borderColor: "border-purple-400 dark:border-purple-500",
    badgeColor: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    placeholder: "Superset A / B — exercises, sets × reps, rest between sets…",
  },
  {
    value: "CARDIO",
    label: "Cardio",
    borderColor: "border-green-400 dark:border-green-500",
    badgeColor: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    placeholder: "Cardio modality, duration, intensity or heart-rate zone…",
  },
  {
    value: "INSTRUCTION",
    label: "Instruction",
    borderColor: "border-zinc-400 dark:border-zinc-500",
    badgeColor: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    placeholder: "Coach notes or instructions for the client…",
  },
  {
    value: "OPTIONAL",
    label: "Optional",
    borderColor: "border-zinc-300 dark:border-zinc-600",
    badgeColor: "bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400",
    placeholder: "Optional exercise — do if time / energy allows…",
  },
];

function getMeta(type: BlockType): BlockMeta {
  return BLOCK_META.find((m) => m.value === type) ?? BLOCK_META[0];
}

export function BlockCard({
  block,
  index,
  onChange,
  onRemove,
}: {
  block: TrainingBlock;
  index: number;
  onChange: (updated: TrainingBlock) => void;
  onRemove: () => void;
}) {
  const meta = getMeta(block.type);

  return (
    <div className={`flex gap-0 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden`}>
      {/* Color stripe */}
      <div className={`w-1 shrink-0 ${meta.borderColor.replace("border-", "bg-")}`} />

      <div className="flex-1 px-3 py-3 space-y-2">
        {/* Type selector + title + remove */}
        <div className="flex items-center gap-2">
          <select
            value={block.type}
            onChange={(e) => onChange({ ...block, type: e.target.value as BlockType })}
            aria-label="Block type"
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${meta.badgeColor} dark:[color-scheme:dark]`}
            style={{ appearance: "auto" }}
          >
            {BLOCK_META.map((m) => (
              <option
                key={m.value}
                value={m.value}
                className="bg-[#0a1224] text-gray-200"
              >
                {m.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={block.title}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            placeholder="Block title (optional)"
            aria-label={`Block ${index + 1} title`}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium placeholder-zinc-400 focus-visible:outline-none"
          />

          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove block ${index + 1}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        {/* Content textarea */}
        <textarea
          value={block.content}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          placeholder={meta.placeholder}
          aria-label={`Block ${index + 1} content`}
          rows={3}
          className="w-full resize-y bg-transparent text-sm leading-relaxed placeholder-zinc-400 focus-visible:outline-none"
        />
      </div>
    </div>
  );
}
