import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { PlanExtras } from "@/types/meal-plan-extras";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#18181b",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#71717a",
  },
  coachLine: {
    fontSize: 9,
    color: "#a1a1aa",
    marginTop: 4,
  },
  mealSection: {
    marginBottom: 16,
  },
  mealHeader: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    color: "#3f3f46",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4d8",
  },
  itemRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  itemRowAlt: {
    backgroundColor: "#fafafa",
  },
  foodName: {
    fontSize: 10,
    flex: 1,
  },
  portion: {
    fontSize: 10,
    color: "#52525b",
    textAlign: "right" as const,
    maxWidth: 160,
  },
  emptyState: {
    textAlign: "center" as const,
    color: "#a1a1aa",
    fontSize: 12,
    marginTop: 60,
  },
  sectionDivider: {
    marginTop: 20,
    marginBottom: 12,
    borderTopWidth: 0.5,
    borderTopColor: "#e4e4e7",
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: "#71717a",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row" as const,
    marginBottom: 4,
  },
  metaLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#a1a1aa",
    width: 80,
    textTransform: "uppercase" as const,
  },
  metaValue: {
    fontSize: 10,
    color: "#18181b",
    flex: 1,
  },
  changesBox: {
    backgroundColor: "#fffbeb",
    borderWidth: 0.5,
    borderColor: "#fbbf24",
    borderRadius: 4,
    padding: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  changesLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#d97706",
    textTransform: "uppercase" as const,
    marginBottom: 2,
  },
  changesText: {
    fontSize: 10,
    color: "#92400e",
  },
  ruleRow: {
    flexDirection: "row" as const,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  ruleCategory: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#71717a",
    textTransform: "uppercase" as const,
    width: 80,
    paddingTop: 1,
  },
  ruleText: {
    fontSize: 10,
    color: "#3f3f46",
    flex: 1,
  },
  supplementRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  supplementName: {
    fontSize: 10,
    color: "#18181b",
    flex: 1,
  },
  supplementDosage: {
    fontSize: 9,
    color: "#71717a",
    width: 80,
    textAlign: "right" as const,
  },
  timingLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#059669",
    textTransform: "uppercase" as const,
    marginBottom: 4,
    marginTop: 6,
  },
  overrideCard: {
    borderWidth: 0.5,
    borderColor: "#d4d4d8",
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  overrideLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#3f3f46",
    marginBottom: 2,
  },
  overrideDays: {
    fontSize: 8,
    color: "#71717a",
    marginBottom: 4,
  },
  overrideChange: {
    fontSize: 9,
    color: "#52525b",
    marginLeft: 8,
    marginBottom: 2,
  },
  overrideMealName: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#3f3f46",
    marginTop: 4,
    marginBottom: 2,
  },
  allowanceCategory: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#71717a",
    textTransform: "uppercase" as const,
    marginBottom: 2,
    marginTop: 6,
  },
  allowanceItems: {
    fontSize: 10,
    color: "#3f3f46",
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  coachNotes: {
    fontSize: 10,
    color: "#3f3f46",
    fontStyle: "italic" as const,
    marginTop: 4,
  },
  macroRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  macroMealName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },
  macroValues: {
    fontSize: 10,
    color: "#52525b",
    textAlign: "right" as const,
    maxWidth: 260,
  },
  macroTotalsRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: "#d4d4d8",
  },
  footer: {
    position: "absolute" as const,
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    borderTopWidth: 0.5,
    borderTopColor: "#e4e4e7",
    paddingTop: 8,
  },
  footerText: {
    fontSize: 8,
    color: "#a1a1aa",
  },
});

export type MealPlanPdfItem = {
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription: string | null;
};

export type MealPlanPdfMacroTarget = {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
};

export type MealPlanPdfData = {
  clientName: string;
  coachName?: string;
  coachHeadline?: string;
  weekLabel?: string;
  /** `MealPlan.planMode`. Omitted is treated as `"MEAL_PLAN"` for callers that
   *  predate macro mode. */
  planMode?: "MEAL_PLAN" | "MACROS";
  items: MealPlanPdfItem[];
  macroTargets?: MealPlanPdfMacroTarget[];
  planExtras?: PlanExtras | null;
  supportContent?: string | null;
};

/** What the PDF actually renders, resolved by `planMode`.
 *
 *  T-101 made `items` and `macroTargets` coexist on every version by design
 *  (carry-forward keeps both representations so switching modes is reversible),
 *  so "which array is non-empty" stopped being a usable signal: a MACROS plan
 *  routinely carries the previous foods plan's items, and its `planExtras`
 *  routinely carries that plan's food-level day overrides. Rendering either of
 *  those in macro mode would hand the client a downloadable document listing
 *  last week's foods as their current plan.
 *
 *  This function is the ONLY place the mode is decided. Callers (today just
 *  `app/api/mealplans/[mealPlanId]/export/route.ts`) pass every column through
 *  unfiltered and let the rules below do the gating, so there is no second
 *  mode check anywhere to drift from this one.
 *
 *  The rules, and why they are NOT symmetric:
 *   - MACROS: macro targets + plan notes, never food rows and never food-level
 *     `planExtras`. This matches `components/client/macro-plan-view.tsx`, which
 *     renders targets + guidance only.
 *   - MEAL_PLAN: food rows + `planExtras`, never macro targets, and
 *     deliberately **no plan notes** — even though the in-app foods view
 *     (`components/client/simple-meal-plan.tsx`) DOES render notes via
 *     `SupportContentSection`. Regression safety: the foods PDF never carried
 *     notes before T-101, and this ticket was a mode-gating fix, not a content
 *     change, so the foods document is kept byte-identical to what coaches and
 *     clients have been downloading. Adding notes there is a product decision
 *     for its own ticket, not a bug fix — so do not "harmonize" this branch
 *     without one.
 *
 *  Exported so the mode gate is unit-testable without parsing PDF bytes. */
export type ResolvedMealPlanPdfContent = {
  mode: "MEAL_PLAN" | "MACROS";
  foodItems: MealPlanPdfItem[];
  macroTargets: MealPlanPdfMacroTarget[];
  planExtras: PlanExtras | null;
  supportContent: string | null;
};

export function resolveMealPlanPdfContent(data: MealPlanPdfData): ResolvedMealPlanPdfContent {
  if (data.planMode === "MACROS") {
    return {
      mode: "MACROS",
      // Never food rows and never food-level plan extras in macro mode, however
      // many of either the row happens to carry.
      foodItems: [],
      macroTargets: data.macroTargets ?? [],
      planExtras: null,
      supportContent: data.supportContent ?? null,
    };
  }
  return {
    mode: "MEAL_PLAN",
    foodItems: data.items,
    macroTargets: [],
    planExtras: data.planExtras ?? null,
    // Intentionally dropped in foods mode — see the asymmetry note above.
    supportContent: null,
  };
}

export async function renderMealPlanPdf(data: MealPlanPdfData): Promise<Buffer> {
  return renderToBuffer(<MealPlanPdfDocument data={data} />) as Promise<Buffer>;
}

function MealPlanPdfDocument({ data }: { data: MealPlanPdfData }) {
  const { clientName, coachName, coachHeadline, weekLabel } = data;
  const resolved = resolveMealPlanPdfContent(data);
  const { mode, foodItems, macroTargets, planExtras, supportContent } = resolved;

  // Group items by meal name
  const grouped = new Map<string, MealPlanPdfItem[]>();
  for (const item of foodItems) {
    const key = item.mealName || "Untitled Meal";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const isEmpty = foodItems.length === 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{coachName ? `${coachName}\u2019s Meal Plan` : "Meal Plan"}</Text>
          <Text style={styles.subtitle}>
            {clientName}
            {weekLabel ? ` — Week of ${weekLabel}` : ""}
          </Text>
          {coachName && (
            <Text style={styles.coachLine}>Coach: {coachName}{coachHeadline ? ` \u2014 ${coachHeadline}` : ""}</Text>
          )}
        </View>

        {/* Metadata */}
        {planExtras?.metadata && (
          <View style={{ marginBottom: 16 }}>
            {planExtras.metadata.phase && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Phase</Text>
                <Text style={styles.metaValue}>{planExtras.metadata.phase}</Text>
              </View>
            )}
            {planExtras.metadata.bodyweight && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Weight</Text>
                <Text style={styles.metaValue}>{planExtras.metadata.bodyweight}</Text>
              </View>
            )}
            {planExtras.metadata.startDate && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Start Date</Text>
                <Text style={styles.metaValue}>{planExtras.metadata.startDate}</Text>
              </View>
            )}
            {planExtras.metadata.highlightedChanges && (
              <View style={styles.changesBox}>
                <Text style={styles.changesLabel}>Changes</Text>
                <Text style={styles.changesText}>{planExtras.metadata.highlightedChanges}</Text>
              </View>
            )}
            {planExtras.metadata.coachNotes && (
              <Text style={styles.coachNotes}>{planExtras.metadata.coachNotes}</Text>
            )}
          </View>
        )}

        {/* Guidance & Support — placed early for visibility */}
        {supportContent && (
          <View style={styles.sectionDivider} wrap={false}>
            <Text style={styles.sectionTitle}>Guidance & Support</Text>
            <Text style={{ fontSize: 10, color: "#3f3f46", lineHeight: 1.4 }}>
              {supportContent}
            </Text>
          </View>
        )}

        {/* Macro Content — macro mode renders targets and never food rows. */}
        {mode === "MACROS" &&
          (macroTargets.length === 0 ? (
            <Text style={styles.emptyState}>
              No macro targets in this plan yet. Check back with your coach.
            </Text>
          ) : (
            <View style={styles.mealSection}>
              <Text style={styles.mealHeader}>Daily Macro Targets</Text>
              {macroTargets.map((target, i) => (
                <View
                  key={`${target.mealName}-${i}`}
                  style={i % 2 === 1 ? [styles.macroRow, styles.itemRowAlt] : styles.macroRow}
                >
                  <Text style={styles.macroMealName}>{target.mealName || "Untitled Meal"}</Text>
                  <Text style={styles.macroValues}>
                    {target.calories} cal • {target.protein}g protein • {target.carbs}g carbs • {target.fats}g fats
                  </Text>
                </View>
              ))}
              <View style={styles.macroTotalsRow}>
                <Text style={styles.macroMealName}>Daily total</Text>
                <Text style={styles.macroValues}>
                  {macroTargets.reduce((sum, t) => sum + t.calories, 0)} cal •{" "}
                  {macroTargets.reduce((sum, t) => sum + t.protein, 0)}g protein •{" "}
                  {macroTargets.reduce((sum, t) => sum + t.carbs, 0)}g carbs •{" "}
                  {macroTargets.reduce((sum, t) => sum + t.fats, 0)}g fats
                </Text>
              </View>
            </View>
          ))}

        {/* Food Content */}
        {mode === "MEAL_PLAN" && (isEmpty ? (
          <Text style={styles.emptyState}>
            No items in this meal plan yet. Check back with your coach.
          </Text>
        ) : (
          Array.from(grouped).map(([mealName, mealItems]) => (
            <View key={mealName} style={styles.mealSection} wrap={false}>
              <Text style={styles.mealHeader}>{mealName}</Text>
              {mealItems.map((item, i) => {
                const portion = item.servingDescription
                  ? item.servingDescription
                  : item.quantity && item.unit
                    ? `${item.quantity} ${item.unit}`
                    : "\u2014";

                return (
                  <View
                    key={`${item.foodName}-${i}`}
                    style={i % 2 === 1 ? [styles.itemRow, styles.itemRowAlt] : styles.itemRow}
                  >
                    <Text style={styles.foodName}>{item.foodName}</Text>
                    <Text style={styles.portion}>{portion}</Text>
                  </View>
                );
              })}
            </View>
          ))
        ))}

        {/* Day Overrides */}
        {planExtras?.dayOverrides && planExtras.dayOverrides.length > 0 && (
          <View style={styles.sectionDivider}>
            <Text style={styles.sectionTitle}>Day Overrides</Text>
            {planExtras.dayOverrides.map((override, i) => (
              <View key={i} style={styles.overrideCard} wrap={false}>
                <Text style={styles.overrideLabel}>{override.label}</Text>
                {override.weekdays && override.weekdays.length > 0 && (
                  <Text style={styles.overrideDays}>{override.weekdays.join(", ")}</Text>
                )}
                {override.notes && <Text style={{ fontSize: 9, color: "#71717a", marginBottom: 4 }}>{override.notes}</Text>}
                {/* New model: meal adjustments */}
                {override.mealAdjustments?.map((adj, j) => (
                  <View key={`adj-${j}`}>
                    <Text style={styles.overrideMealName}>{adj.mealName}</Text>
                    {adj.changes.map((ch, k) => {
                      const desc = ch.type === "update" ? `${ch.food} → ${ch.newPortion}`
                        : ch.type === "add" ? `Add: ${ch.food}${ch.newPortion ? ` (${ch.newPortion})` : ""}`
                        : ch.type === "remove" ? `Remove: ${ch.food}`
                        : `Replace ${ch.food} → ${ch.replacementFood}${ch.replacementPortion ? ` (${ch.replacementPortion})` : ""}`;
                      return <Text key={k} style={styles.overrideChange}>{desc}</Text>;
                    })}
                    {adj.notes && <Text style={{ fontSize: 8, color: "#a1a1aa", marginLeft: 8 }}>{adj.notes}</Text>}
                  </View>
                ))}
                {/* Legacy model */}
                {override.items?.map((item, j) => (
                  <Text key={`leg-${j}`} style={styles.overrideChange}>
                    {item.food}{item.portion ? ` — ${item.portion}` : ""}
                    {item.replaces ? ` (replaces ${item.replaces})` : ""}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Obsolete sections removed */}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated by Steadfast (Beta)
          </Text>
          <Text style={styles.footerText}>
            {new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
