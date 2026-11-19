import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publicationState } from "@/lib/meal-plans/publication-state";
import { foodsEditorSignature, macroEditorSignature } from "@/lib/meal-plans/editor-state";
import { trainingEditorSignature } from "@/lib/training-programs/editor-signature";
import { groupItemsToMeals } from "@/types/meal-plan";
import { MealPlanActions } from "@/components/coach/meal-plan/meal-plan-actions";
import { TodayPlanCards, CardioSummary } from "@/components/client/today-plan-cards";
import { readFileSync } from "node:fs";

const food = { mealName: "Breakfast", foodName: "Oats", quantity: "80", unit: "g", servingDescription: "80 g", calories: 300, protein: 10, carbs: 54, fats: 5 };
const signature = (quantity = "80", notes = "") => foodsEditorSignature(groupItemsToMeals([{ ...food, quantity }]), null, notes);

describe("publication confirmation", () => {
  it("ignores JSON object key order but preserves meal order", () => {
    expect(publicationState('{"metadata":{"phase":"Cut","coachNotes":"Note"}}', '{"metadata":{"coachNotes":"Note","phase":"Cut"}}').matchesPublished).toBe(true);
    expect(publicationState('["Breakfast","Lunch"]', '["Lunch","Breakfast"]').canPublish).toBe(true);
  });
  it("disables unchanged published content, including freshly regenerated row ids", () => {
    expect(publicationState(signature(), signature()).canPublish).toBe(false);
  });
  it("enables a new plan and edits, and disables again after undo or successful publication", () => {
    expect(publicationState(signature(), null).canPublish).toBe(true);
    expect(publicationState(signature("90"), signature()).canPublish).toBe(true);
    expect(publicationState(signature("80"), signature()).matchesPublished).toBe(true);
    expect(publicationState(signature("90"), signature("90")).matchesPublished).toBe(true);
  });
  it("includes notes, extras and macro targets in the comparison", () => {
    expect(publicationState(signature("80", "New notes"), signature()).canPublish).toBe(true);
    const meals = [{ mealName: "Breakfast", calories: 300, protein: 10, carbs: 54, fats: 5 }];
    expect(publicationState(macroEditorSignature(meals, ""), macroEditorSignature([{ ...meals[0], protein: 20 }], "")).canPublish).toBe(true);
    expect(foodsEditorSignature(groupItemsToMeals([food]), { metadata: { phase: "Cut" } }, "")).not.toBe(signature());
  });
  it("includes training content and cardio while ignoring database ids", () => {
    const program = { days: [{ dayName: "__CARDIO__", blocks: [{ type: "CARDIO" as const, title: "Walk|3/week|20 min|Easy", content: "" }] }] };
    const baseline = trainingEditorSignature(program);
    expect(trainingEditorSignature({ ...program, weeklyFrequency: null })).toBe(baseline);
    expect(trainingEditorSignature({ ...program, clientNotes: "New notes" })).not.toBe(baseline);
    expect(trainingEditorSignature({ days: [] })).not.toBe(baseline);
  });
  it("renders persistent confirmation and disables publish and save for unchanged content", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(MealPlanActions, {
      saving: false, publishing: false, isUnsaved: false, notifyClient: true,
      canPublish: false, publicationMessage: publicationState("same", "same").message,
      onNotifyChange: noop, onSave: noop, onPublish: noop,
      itemCount: 1,
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain("matches the plan shared");
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Published<\/button>/);
  });
});

describe("client dashboard tiles", () => {
  it.each([[-2, 5], [0, 5], [2, 3], [5, 0], [10, 0]])("shows %i logged without exceeding the plan total", (loggedMeals, remaining) => {
    const html = renderToStaticMarkup(createElement(TodayPlanCards, { hasMealPlan: true, totalMeals: 5, loggedMeals, trainingDays: 4, totalExercises: 20 }));
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("aspect-square");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(`aria-valuenow="${Math.min(5, Math.max(0, loggedMeals))}"`);
    if (remaining === 0) {
      expect(html).toContain(">Done</span>");
      expect(html).toContain("All meals logged");
    } else {
      expect(html).toContain(`>${remaining}</span>`);
      expect(html).toContain(">left</span>");
    }
    expect(html).toContain("Choose a day");
  });
  it("handles absent and empty plans without inventing progress", () => {
    expect(renderToStaticMarkup(createElement(TodayPlanCards, { hasMealPlan: false, totalMeals: 0, loggedMeals: 0, trainingDays: 0, totalExercises: 0 }))).toBe("");
    const html = renderToStaticMarkup(createElement(TodayPlanCards, { hasMealPlan: true, totalMeals: 0, loggedMeals: 0, trainingDays: 0, totalExercises: 0 }));
    expect(html).toContain("No meals scheduled");
    expect(html).toContain("No meals yet");
    expect(html).not.toContain(">Done</span>");
    expect(html).not.toContain("stroke-dasharray");
    expect(html).not.toContain("NaN");
  });
  it("uses a thick track without a misleading progress dot before any meal is logged", () => {
    const html = renderToStaticMarkup(createElement(TodayPlanCards, { hasMealPlan: true, totalMeals: 12, loggedMeals: 0, trainingDays: 0, totalExercises: 0 }));
    expect(html).toContain('stroke-width="12"');
    expect(html.match(/<circle\b/g)).toHaveLength(1);
    expect(html).toContain(">12</span>");
  });
  it("renders cardio with labeled values instead of chips", () => {
    const html = renderToStaticMarkup(createElement(CardioSummary, { modality: "Stairmaster", frequency: "5 days/week", duration: "30 mins", intensity: "Level 6", notes: "" }));
    expect(html).toContain("<dl");
    expect(html).toContain("Stairmaster");
    expect(html).not.toContain("bg-green-500");
  });
  it("does not apply container press or hover effects to nested controls", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).not.toMatch(/\.sf-glass-card:(?:active|hover)\s*\{/);
    expect(css).toContain(".sf-glass-card:is(a[href], button):hover");
  });
});
