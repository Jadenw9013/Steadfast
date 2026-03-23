import type { Rule } from "@/types/meal-plan-extras";
import { RULE_CATEGORY_ORDER } from "@/types/meal-plan-extras";

const CATEGORY_CONFIG: Record<string, { dotBg: string }> = {
  "Meal Timing":    { dotBg: "bg-blue-400" },
  "Hydration":      { dotBg: "bg-cyan-400" },
  "Cardio":         { dotBg: "bg-orange-400" },
  "Check-In":       { dotBg: "bg-emerald-400" },
  "Communication":  { dotBg: "bg-violet-400" },
  "Cooking":        { dotBg: "bg-amber-400" },
  "Other":          { dotBg: "bg-zinc-500" },
};

function getCategoryConfig(category: string) {
  return CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG["Other"]!;
}

export function CoachRulesCard({ rules }: { rules: Rule[] }) {
  if (!rules.length) return null;

  const grouped = new Map<string, string[]>();
  for (const rule of rules) {
    if (!grouped.has(rule.category)) grouped.set(rule.category, []);
    grouped.get(rule.category)!.push(rule.text);
  }

  const sortedEntries = [...grouped.entries()].sort(([a], [b]) => {
    const ai = (RULE_CATEGORY_ORDER as readonly string[]).indexOf(a);
    const bi = (RULE_CATEGORY_ORDER as readonly string[]).indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div
      className="rounded-2xl border border-white/[0.06] bg-[#0d1829] p-4"
      role="region"
      aria-label="Coach rules and guidelines"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Coach Rules &amp; Guidelines
      </p>
      <div>
        {sortedEntries.map(([category, texts]) => {
          const cfg = getCategoryConfig(category);
          return (
            <div
              key={category}
              className="flex items-start gap-3 border-b border-white/[0.04] py-2 last:border-0"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cfg.dotBg}`}
                aria-hidden="true"
              />
              <div>
                <h3 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {category}
                </h3>
                <p className="text-sm leading-snug text-zinc-300">
                  {texts.join(" · ")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
