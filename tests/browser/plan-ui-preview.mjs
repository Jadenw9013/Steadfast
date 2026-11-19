import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";

const root = process.cwd();
function fromStore(prefix, name) {
  const entry = readdirSync(`${root}/node_modules/.pnpm`).find((name) => name.startsWith(prefix));
  if (!entry) throw new Error(`Missing installed dependency: ${prefix}`);
  return createRequire(`${root}/node_modules/.pnpm/${entry}/node_modules/${name}/package.json`);
}
const { build } = fromStore("esbuild@", "esbuild")("esbuild");
const postcssRequire = fromStore("@tailwindcss+postcss@", "@tailwindcss/postcss");
const css = await postcssRequire("postcss")([postcssRequire("@tailwindcss/postcss")()])
  .process(readFileSync(`${root}/app/globals.css`, "utf8"), { from: `${root}/app/globals.css` });
const mockActions = `
  const result = async () => ({ ok: true, success: true });
  export const createDraftMealPlan = async () => ({ mealPlanId: "synthetic-draft" });
  export const saveDraftMealPlan = result;
  export const publishMealPlan = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return window.location.search.includes("failure") ? { ok: false, error: "Synthetic publish failure. Please try again." } : { ok: true }; };
  export const discardDraftMealPlan = result;
  export const setClientPlanMode = result;
  export const saveTrainingProgram = async () => ({ programId: "synthetic-training" });
  export const publishTrainingProgram = async () => window.location.search.includes("failure") ? { error: "Synthetic publish failure. Please try again." } : { success: true };
  export const addFoodLibraryItem = result;
  export const listPlanSnippets = async () => [];
  export const savePlanSnippet = result;
  export const getPlanSnippet = result;
  export const deletePlanSnippet = result;
`;
const bundle = await build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { TodayPlanCards, CardioSummary } from "./components/client/today-plan-cards";
      import { MealPlanEditorV2 } from "./components/coach/meal-plan/meal-plan-editor-v2";
      import { MacroPlanEditor } from "./components/coach/meal-plan/macro-plan-editor";
      import { TrainingProgramEditor } from "./components/coach/training/training-program-editor";
      import { foodsEditorSignature, macroEditorSignature } from "./lib/meal-plans/editor-state";
      import { trainingEditorSignature } from "./lib/training-programs/editor-signature";
      import { groupItemsToMeals } from "./types/meal-plan";
      const items = [{ mealName: "Breakfast", foodName: "Oats", quantity: "80", unit: "g", servingDescription: "80 g", calories: 300, protein: 10, carbs: 54, fats: 5 }];
      const macroTargets = [{ mealName: "Breakfast", calories: 300, protein: 10, carbs: 54, fats: 5 }];
      const effectivePlan = { source: "published", draftId: null, publishedId: "synthetic-published", carriedForwardFrom: null, clientPlanMode: "MEAL_PLAN", editorMode: "MEAL_PLAN", planExtras: null, supportContent: "", items, macroTargets, publishedContent: { mode: "MEAL_PLAN", signature: foodsEditorSignature(groupItemsToMeals(items), null, "") } };
      const training = { id: "synthetic-training", status: "PUBLISHED", days: [{ dayName: "Upper body", blocks: [{ type: "EXERCISE", title: "Row", content: "3 sets of 10" }] }], weeklyFrequency: null, clientNotes: "", injuries: "", equipment: "", templateSourceId: "" };
      const props = { clientId: "synthetic-client", weekStartDate: "2026-11-16", effectivePlan, foods: [] };
      const path = window.location.pathname;
      createRoot(document.getElementById("root")).render(
        <main className="mx-auto space-y-5 p-4" style={{ maxWidth: path === "/client" ? 560 : 1100 }}>
          <p className="text-xs text-zinc-400">Synthetic preview — no account, database, or email writes.</p>
          {path === "/client" ? <><TodayPlanCards hasMealPlan totalMeals={5} loggedMeals={2} trainingDays={5} totalExercises={28} /><CardioSummary modality="Stairmaster" frequency="5 days/week" duration="30 mins" intensity="Level 6" notes="" /></>
            : path === "/macro" ? <MacroPlanEditor {...props} effectivePlan={{ ...effectivePlan, editorMode: "MACROS", publishedContent: { mode: "MACROS", signature: macroEditorSignature(macroTargets, "") } }} />
            : path === "/training" ? <TrainingProgramEditor clientId="synthetic-client" weekStartDate="2026-11-16" initialProgram={training} publishedSignature={trainingEditorSignature(training)} />
            : <div className="sf-glass-card p-4"><MealPlanEditorV2 {...props} /></div>}
        </main>
      );
    `,
    loader: "tsx", resolveDir: root,
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  tsconfig: `${root}/tsconfig.json`,
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{
    name: "synthetic-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^@\/app\/actions\// }, (args) => ({ path: args.path, namespace: "actions" }));
      builder.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: mockActions, loader: "js" }));
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: "next-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "next-mock" }, (args) => ({
        contents: args.path === "next/link"
          ? 'import React from "react"; export default function Link(props) { return React.createElement("a", props); }'
          : 'export const useRouter = () => ({ refresh() {}, push() {} });',
        loader: "js", resolveDir: root,
      }));
    },
  }],
  outdir: "/tmp/steadfast-plan-ui-preview",
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const moduleCss = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:4180");
  if (url.pathname === "/preview.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    return response.end(script);
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  if (url.pathname === "/mobile") {
    return response.end('<html style="background:#111;color:#ddd"><body><p>375px mobile viewport</p><iframe title="Mobile client preview" src="/client" style="width:375px;height:760px;border:1px solid #333"></iframe></body></html>');
  }
  response.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}\n${moduleCss}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>`);
});
server.listen(4180, "127.0.0.1", () => console.log("Synthetic plan UI preview: http://127.0.0.1:4180/mobile (also /coach, /macro, /training)"));
