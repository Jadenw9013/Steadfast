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
  .process(readFileSync(`${root}/app/globals.css`, "utf8") + "\n" + readFileSync(`${root}/app/palette.css`, "utf8"), { from: `${root}/app/globals.css` });
const fontFaces = readdirSync(`${root}/.next/static/chunks`)
  .filter((name) => name.endsWith(".css"))
  .flatMap((name) => readFileSync(`${root}/.next/static/chunks/${name}`, "utf8").match(/@font-face\{[^}]+\}/g) ?? [])
  .filter((face) => /font-family:(?:Sora|Chakra Petch);/.test(face));
if (!fontFaces.length) throw new Error("Run pnpm build first so the preview can use the production fonts.");
const fontFiles = new Map(fontFaces.map((face) => {
  const filename = face.match(/url\(\.\.\/media\/([^)]+)\)/)[1];
  return [`/fonts/${filename}`, readFileSync(`${root}/.next/static/media/${filename}`)];
}));
const fontCss = fontFaces.join("\n").replaceAll("../media/", "/fonts/") + ':root { --font-sora: "Sora", sans-serif; --font-chakra: "Chakra Petch", sans-serif; }';
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
  export const sendClientInvite = async () => ({ success: true, emailSent: !window.location.search.includes("failure"), inviteToken: "synthetic-invite" });
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
      import { MobileBottomNav } from "./components/ui/mobile-bottom-nav";
      import { InviteForm } from "./app/coach/clients/invite/invite-form";
      import { foodsEditorSignature, macroEditorSignature } from "./lib/meal-plans/editor-state";
      import { trainingEditorSignature } from "./lib/training-programs/editor-signature";
      import { groupItemsToMeals } from "./types/meal-plan";
      const items = [{ mealName: "Breakfast", foodName: "Oats", quantity: "80", unit: "g", servingDescription: "80 g", calories: 300, protein: 10, carbs: 54, fats: 5 }];
      const macroTargets = [{ mealName: "Breakfast", calories: 300, protein: 10, carbs: 54, fats: 5 }];
      const effectivePlan = { source: "published", draftId: null, publishedId: "synthetic-published", carriedForwardFrom: null, clientPlanMode: "MEAL_PLAN", editorMode: "MEAL_PLAN", planExtras: null, supportContent: "", items, macroTargets, publishedContent: { mode: "MEAL_PLAN", signature: foodsEditorSignature(groupItemsToMeals(items), null, "") } };
      const training = { id: "synthetic-training", status: "PUBLISHED", days: [{ dayName: "Upper body", blocks: [{ type: "EXERCISE", title: "Row", content: "3 sets of 10" }] }], weeklyFrequency: null, clientNotes: "", injuries: "", equipment: "", templateSourceId: "" };
      const props = { clientId: "synthetic-client", weekStartDate: "2026-11-16", effectivePlan, foods: [] };
      const path = window.location.pathname;
      const parameters = new URLSearchParams(window.location.search);
      const totalMeals = Number(parameters.get("meals") ?? 5);
      const loggedMeals = Number(parameters.get("logged") ?? 2);
      createRoot(document.getElementById("root")).render(
        <main className="sf-app-shell mx-auto min-h-screen space-y-5 p-4 pb-24" style={{ maxWidth: path === "/client" ? 560 : 1100 }}>
          <p className="text-xs text-zinc-400">Synthetic preview — no account, database, or email writes.</p>
          {path === "/palette" ? <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-5">
              <section className="sf-gradient-card space-y-3 p-5"><p className="text-xs font-semibold uppercase tracking-widest text-blue-200">Your progress</p><h1 className="text-2xl font-semibold text-zinc-100">Keep showing up.</h1><p className="text-sm text-zinc-300">Your next check-in is ready when you are.</p><button className="sf-button-primary">Open check-in</button></section>
              <TodayPlanCards hasMealPlan totalMeals={5} loggedMeals={2} trainingDays={5} totalExercises={28} />
              <CardioSummary modality="Stairmaster" frequency="5 days/week" duration="30 mins" intensity="Level 6" notes="" />
            </div>
            <div className="space-y-5">
              <section className="sf-glass-card space-y-4 p-5"><h2 className="text-lg font-semibold text-zinc-100">Coach workspace</h2><p className="text-sm text-zinc-400">Review progress and keep your clients moving forward.</p><div className="flex flex-wrap gap-2"><span className="sf-badge success">On track</span><span className="sf-badge warning">Due soon</span><span className="sf-badge danger">Needs attention</span><span className="sf-badge info">Published</span></div><label className="block space-y-2 text-sm text-zinc-300"><span>Plan name</span><input className="sf-input" placeholder="Weekly meal plan" /></label><div className="flex flex-wrap gap-3"><button className="sf-button-primary">Publish plan</button><button className="sf-button-secondary">Save draft</button><button className="sf-button-primary" disabled>Published</button></div></section>
              <section className="sf-stat-card"><p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Weekly consistency</p><p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-100">86<span className="text-lg text-zinc-400">%</span></p><p className="mt-2 text-sm text-emerald-400">Building a steady routine</p></section>
            </div>
          </div> : path === "/client" ? <><TodayPlanCards hasMealPlan totalMeals={totalMeals} loggedMeals={loggedMeals} trainingDays={5} totalExercises={28} /><CardioSummary modality="Stairmaster" frequency="5 days/week" duration="30 mins" intensity="Level 6" notes="" /><MobileBottomNav role="client" hasCoach /></>
            : path === "/invite" ? <InviteForm />
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
          : 'export const useRouter = () => ({ refresh() {}, push() {} }); export const usePathname = () => window.location.pathname;',
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
  if (fontFiles.has(url.pathname)) {
    response.writeHead(200, { "Content-Type": "font/woff2" });
    return response.end(fontFiles.get(url.pathname));
  }
  if (url.pathname === "/preview.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    return response.end(script);
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  if (url.pathname === "/mobile") {
    return response.end('<html style="background:#111;color:#ddd"><body><p>375px mobile viewport</p><iframe title="Mobile client preview" src="/client" style="width:375px;height:760px;border:1px solid #333"></iframe></body></html>');
  }
  response.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}\n${moduleCss}\n${fontCss}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>`);
});
server.listen(4180, "127.0.0.1", () => console.log("Synthetic plan UI preview: http://127.0.0.1:4180/mobile (also /coach, /macro, /training)"));
