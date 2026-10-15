/**
 * Shared style constants for `/client/ai-coach/*` screens
 * (design-system/steadfast/pages/ai-coach.md). Extracted from
 * `experience.tsx` (T-2024) so the intake wizard reuses the exact same
 * tokens instead of duplicating strings — permanent dark mode, 48px
 * minimum tap targets, 56px primary action, 16px input text.
 */
export const button =
  "min-h-12 rounded-xl border border-white/15 px-4 py-3 text-zinc-100 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50";
export const primary = `${button} min-h-14 border-blue-500 bg-blue-600 hover:bg-blue-500`;
export const fieldClass =
  "mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-base text-zinc-100 focus:outline-2 focus:outline-blue-400";
export const inputStyle = { fontSize: "max(1rem, 16px)" } as const;
