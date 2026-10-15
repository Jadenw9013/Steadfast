// AI Coach intake wizard UI evidence harness (T-2028 r3 checks + T-2055 follow-ups).
// Mounts the real IntakeWizard against a synthetic in-memory HTTP boundary.
// No DB, no auth, no external network.
//
// Run (cwd = the worktree under test):
//   node tests/browser/ai-coach-intake-wizard-evidence.mjs
// Screenshots go to EVIDENCE_OUT_DIR, default
//   /Users/jadenwong/Dev/steadfast/hq/board/evidence/ui/T-2055
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(`${root}/package.json`);
function requireFromStore(prefix, sub) {
  const storeDir = `${root}/node_modules/.pnpm`;
  const entry = readdirSync(storeDir).find((n) => n.startsWith(prefix));
  return createRequire(`${storeDir}/${entry}/node_modules/${sub}/package.json`)(sub);
}
const { build } = requireFromStore("esbuild@", "esbuild");
const { chromium } = require("@playwright/test");
const OUT_DIR = process.env.EVIDENCE_OUT_DIR ?? "/Users/jadenwong/Dev/steadfast/hq/board/evidence/ui/T-2055";
mkdirSync(OUT_DIR, { recursive: true });

async function compileCss() {
  const storeDir = `${root}/node_modules/.pnpm`;
  const entry = readdirSync(storeDir).find((n) => n.startsWith("@tailwindcss+postcss@"));
  const pkgDir = `${storeDir}/${entry}/node_modules/@tailwindcss/postcss`;
  const req = createRequire(`${pkgDir}/package.json`);
  const css = readFileSync(`${root}/app/globals.css`, "utf8");
  return (await req("postcss")([req("@tailwindcss/postcss")()]).process(css, { from: `${root}/app/globals.css`, to: `${root}/out.css` })).css;
}

const BASE = {
  intakeVersion: 2, goal: "BODY_COMPOSITION", experienceLevel: "RETURNING", trainingDaysPerWeek: 4,
  equipmentAccess: ["HOME_BASIC"], foodBudgetLevel: "MODERATE", trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "IMPERIAL", ageStatus: "CONFIRMED", ageYears: 34,
  energyMethodPopulationCategoryStatus: "UNKNOWN", physicalActivityCategoryStatus: "UNKNOWN",
  bodyMeasurementStatus: "CONFIRMED", heightCm: 168, weightKg: 63, weightMeasuredOn: "2026-09-27",
  goalStatus: "CONFIRMED", bodyWeightIntent: "LOSE", goalPaceClass: "UNDECIDED", weightNeutralAccepted: false,
  trainingContextStatus: "CONFIRMED", resistanceTrainingContext: "OCCASIONAL", sessionLengthBand: "MIN_45_60",
  cookingAccessStatus: "UNKNOWN", dislikes: [], cuisinePreferences: [],
  allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: false, items: [
    { category: "TREE_NUT", specificity: null, kind: "ALLERGY", crossContactAvoidanceRequired: "UNSURE" } ] },
  dietaryPattern: { pattern: "OTHER", otherLabel: "High protein", mandatory: false, reason: "PREFERENCE", status: "CONFIRMED" },
};
const V2_ALSO = { ...BASE, allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: false, items: [
  { category: "TREE_NUT", specificity: "cashew", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" },
  { category: "SESAME", specificity: null, kind: "ALLERGY", crossContactAvoidanceRequired: "UNSURE" },
  { category: "FISH", specificity: "salmon", kind: "INTOLERANCE_OR_SENSITIVITY", crossContactAvoidanceRequired: "NO" } ] } };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { allergenDeclarations: _a, dietaryPattern: _d, ...BASE_NO_V2 } = BASE;
const LONG = "x".repeat(90);
const V1_ALLERGY = { ...BASE_NO_V2, dietaryPattern: BASE.dietaryPattern, allergies: ["kiwi", "strawberries", "   ", LONG] };
const V1_DIET = { ...BASE_NO_V2, allergenDeclarations: BASE.allergenDeclarations, dietaryRestrictions: ["vegan", "low sodium"] };
const MANDATORY = { ...BASE, dietaryPattern: { pattern: "LACTO_OVO_VEGETARIAN", otherLabel: null, mandatory: true, reason: "RELIGIOUS_OR_ETHICAL", status: "CONFIRMED" } };
const PREFERENCE = { ...BASE, dietaryPattern: { pattern: "PESCATARIAN", otherLabel: null, mandatory: false, reason: "PREFERENCE", status: "CONFIRMED" } };

const css = await compileCss();
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { IntakeWizard } from './components/ai-coach/intake-wizard';
    function Harness({ initialView, initialStage }) {
      const [view, setView] = React.useState(initialView);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      async function post(url, input) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, requestKey: crypto.randomUUID() }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error?.message ?? 'failed'); return j.data;
      }
      async function act(work) { if (busy) return; setBusy(true); setError('');
        try { await work(); const r = await fetch('/api/client/ai-coach/workspace'); setView({ ...view, ...(await r.json()).data }); }
        catch (e) { setError(String(e.message)); } finally { setBusy(false); } }
      const command = (input) => post('/api/client/ai-coach/commands', { expectedProfileRevision: view.profileRevision, ...input });
      return React.createElement('main', { style: { maxWidth: '48rem', margin: '0 auto' } },
        error && React.createElement('p', { role: 'alert', className: 'mb-4 text-red-300' }, error),
        React.createElement(IntakeWizard, { view, busy, act, command, post, initialStage }));
    }
    window.__mount = (view, stage) => createRoot(document.getElementById('root')).render(React.createElement(Harness, { initialView: view, initialStage: stage }));
  `, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
});
const html = `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#09090b;margin:0;padding:16px"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;

const results = [];
const failures = [];
const rec = (state, ok, note) => { results.push({ state, ok, note }); if (!ok) failures.push(`${state}: ${note}`); console.log(`${ok ? "PASS" : "FAIL"} ${state}: ${note}`); };

async function open(browser, width, confirmedIntake, stage, { safetyDone = confirmedIntake !== null, colorScheme = "dark" } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme });
  const state = { confirmedIntake, draft: null, profileRevision: 1, ops: [] };
  await page.route("http://localhost:4177/**", async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    if (p === "/api/client/ai-coach/workspace") return route.fulfill({ json: { data: { confirmedIntake: state.confirmedIntake, draft: state.draft, profileRevision: state.profileRevision } } });
    if (p === "/api/client/ai-coach/commands") { const input = req.postDataJSON(); state.ops.push(input);
      if (input.operation === "SAVE_INTAKE") state.draft = { ...(state.draft ?? {}), ...input.answers };
      if (input.operation === "CONFIRM_INTAKE") { state.confirmedIntake = { ...input.answers }; state.draft = null; }
      return route.fulfill({ json: { data: { saved: true } } }); }
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://localhost:4177/");
  await page.evaluate(([v, s]) => window.__mount(v, s), [{ confirmedIntake, draft: null, profileRevision: 1, safetyDisclosureCompleted: safetyDone }, stage]);
  await page.locator("h2").first().waitFor();
  return { page, state };
}

async function audit(page, name, width) {
  const issues = [];
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) issues.push("horizontal overflow");
  for (const b of await page.locator("button:visible").all()) {
    const box = await b.boundingBox();
    if (box && (box.height < 48)) issues.push(`button "${(await b.innerText()).slice(0, 40)}" h=${box.height}`);
  }
  for (const i of await page.locator("input:visible").all()) {
    const fs = await i.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    if (fs < 16) issues.push(`input font ${fs}px`);
  }
  // dark: wizard card background luminance
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector("#root .rounded-2xl")).backgroundColor);
  const nums = bg.match(/[\d.]+/g).map(Number);
  if (nums[0] + nums[1] + nums[2] > 150) issues.push(`card bg not dark: ${bg}`);
  rec(`${name}@${width} layout`, issues.length === 0, issues.length ? issues.join("; ") : `no overflow, buttons>=48, inputs>=16, card bg ${bg}`);
}
const shot = (page, name, width) => page.screenshot({ path: `${OUT_DIR}/${name}-${width}.png`, fullPage: true });
const btn = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });
const pressed = async (loc) => (await loc.getAttribute("aria-pressed")) === "true";
const text = (page) => page.locator("body").innerText();

async function finishFromStep2(page) {
  await btn(page, /^4 days/).click(); await btn(page, /Home Dumbbells/).click(); await btn(page, "Regular").click(); await btn(page, /^45–60m/).click(); await btn(page, "Continue").click();
  await page.getByRole("heading", { name: "Make nutrition fit your style" }).waitFor();
  await btn(page, /^High Protein/).click(); await btn(page, /^Moderate/).click(); await btn(page, /Exact Macros/).click(); await btn(page, /^None$/).click(); await btn(page, "Continue").click();
  await page.getByRole("heading", { name: "Last step: your starting stats" }).waitFor();
  await page.getByLabel("Height in feet").fill("5"); await page.getByLabel("Additional height in inches").fill("7");
  await page.getByLabel(/Weight \(lb\)/).fill("150"); await page.getByLabel("Age").fill("34");
  await btn(page, /None of these apply/).click();
  await btn(page, "Confirm my answers").click();
  await page.waitForURL("http://localhost:4177/client/ai-coach", { timeout: 8000 }).catch(() => {});
}

const browser = await chromium.launch({ args: ["--no-proxy-server"], executablePath: "/Users/jadenwong/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
try {
  for (const width of [390, 1280]) {
    // 1. Step 2 current strength training required
    {
      const { page, state } = await open(browser, width, null, 1);
      const t = await text(page);
      rec(`step2-current-training@${width} visible`, t.includes("Current strength training") && (await btn(page, "None").count()) === 1 && (await btn(page, /^Occasional/).count()) === 1 && (await btn(page, /^Regular/).count()) === 1, "question + None/Occasional/Regular rendered, nothing pre-pressed: " + !(await pressed(btn(page, "None"))));
      await btn(page, /^4 days/).click(); await btn(page, /Home Dumbbells/).click(); await btn(page, /^45–60m/).click();
      await btn(page, "Continue").click();
      await page.getByText("Choose your current strength training.").waitFor({ timeout: 3000 }).catch(() => {});
      const blocked = (await page.getByText("Choose your current strength training.").count()) === 1 && (await page.getByRole("heading", { name: "Set up your training week" }).count()) === 1 && state.ops.length === 0;
      rec(`step2-current-training@${width} required`, blocked, "Continue without it shows 'Choose your current strength training.' and sends nothing");
      await audit(page, "step2-current-training-required", width);
      await shot(page, "step2-current-training-required", width);
      await btn(page, "Occasional").click();
      await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Make nutrition fit your style" }).waitFor();
      const save = state.ops.find((o) => o.operation === "SAVE_INTAKE");
      rec(`step2-current-training@${width} saved`, save?.answers?.trainingContextStatus === "CONFIRMED" && save?.answers?.resistanceTrainingContext === "OCCASIONAL" && save?.answers?.sessionLengthBand === "MIN_45_60", `SAVE_INTAKE answers ${JSON.stringify({ s: save?.answers?.trainingContextStatus, r: save?.answers?.resistanceTrainingContext, b: save?.answers?.sessionLengthBand })}`);
      await page.close();
    }
    // 2. v2 Also on file with Remove
    {
      const { page } = await open(browser, width, V2_ALSO, 2);
      const t = await text(page);
      const hasAlso = t.includes("Also on file") && (await btn(page, /^Remove Sesame/).count()) === 1 && (await btn(page, /^Remove Fish \(salmon\), intolerance/).count()) === 1;
      rec(`v2-also-on-file@${width} shown`, hasAlso && await pressed(btn(page, /^Tree Nuts/)), "Also on file lists Sesame + Fish (salmon), intolerance with Remove; Tree Nuts chip pressed (cashew)");
      await audit(page, "v2-also-on-file", width);
      await shot(page, "v2-also-on-file", width);
      await btn(page, /^None$/).click();
      await btn(page, "Continue").click();
      const blocked = (await page.getByText("Remove the other allergens on file before choosing None.").count()) === 1 && (await page.getByText("Also on file").count()) === 1;
      rec(`v2-also-on-file@${width} None does not erase`, blocked, "None leaves Also-on-file intact and blocks Continue");
      await shot(page, "v2-also-on-file-none-blocked", width);
      await btn(page, /^Remove Sesame/).click(); await btn(page, /^Remove Fish/).click();
      rec(`v2-also-on-file@${width} Remove`, (await page.getByText("Also on file").count()) === 0, "explicit Remove clears the list");
      await page.close();
    }
    // 3. v1 free-text allergy tokens
    {
      const { page } = await open(browser, width, V1_ALLERGY, 2);
      const t = await text(page);
      const shown = t.includes("Also on file") && (await btn(page, "Remove kiwi").count()) === 1 && (await btn(page, "Remove strawberries").count()) === 1;
      const unsav = t.includes("Earlier entries that cannot be saved as written") && t.includes("(blank entry)") && t.includes(LONG);
      const readOnly = (await page.locator("input:visible, textarea:visible").count()) === 0;
      rec(`v1-allergy-tokens@${width} shown read-only`, shown && unsav && readOnly, `kiwi/strawberries under Also on file; blank + 90-char token under 'cannot be saved'; no editable inputs on step: ${readOnly}`);
      rec(`v1-allergy-tokens@${width} T-2055 copy`, t.includes("These earlier allergy entries cannot be carried into the new format exactly as written, and no option on this step matches them. We will not shorten or change them for you. If one still applies, contact support before you remove it.") && !t.includes("choose the matching") && (await page.getByText(LONG, { exact: true }).isVisible()), "new contact-support copy shown, old chip pointer gone, full 90-char token visible");
      rec(`v1-allergy-tokens@${width} earlier-format warning`, t.includes("allergy answers were saved in an earlier format"), "step-3 earlier-format pause warning shown");
      await audit(page, "v1-allergy-tokens", width);
      await shot(page, "v1-allergy-tokens", width);
      await btn(page, /^None$/).click();
      await btn(page, "Continue").click();
      const t2 = await text(page);
      const kept = t2.includes("kiwi") && t2.includes("strawberries") && t2.includes("Remove the other allergens on file before choosing None.") && t2.includes("Remove each earlier allergy entry that cannot be saved as written.");
      rec(`v1-allergy-tokens@${width} not erasable by None`, kept, "after None, tokens still listed and Continue blocked with both issues");
      await shot(page, "v1-allergy-tokens-none-blocked", width);
      await page.close();
    }
    // 4. v1 diet restriction keep/remove gate
    {
      const { page, state } = await open(browser, width, V1_DIET, 2);
      const t = await text(page);
      rec(`v1-diet-gate@${width} shown`, t.includes("Dietary restrictions from your earlier answers") && (await btn(page, "Keep as a requirement: Vegan").count()) === 1 && (await btn(page, "Remove vegan").count()) === 1 && (await btn(page, "Remove low sodium").count()) === 1 && t.includes("This earlier entry cannot be kept as written"), "vegan has Keep/Remove; low sodium Remove only with explanation");
      await audit(page, "v1-diet-gate", width);
      await shot(page, "v1-diet-gate", width);
      await btn(page, "Continue").click();
      const blocked = (await page.getByText("Keep or remove each dietary restriction from your earlier answers.").count()) === 1 && (await page.getByRole("heading", { name: "Make nutrition fit your style" }).count()) === 1 && state.ops.length === 0;
      rec(`v1-diet-gate@${width} blocks step 3`, blocked, "Continue blocked, no command sent");
      await shot(page, "v1-diet-gate-blocked", width);
      await btn(page, "Keep as a requirement: Vegan").click();
      await btn(page, "Remove low sodium").click();
      const t2 = await text(page);
      rec(`v1-diet-gate@${width} resolves`, t2.includes("On file as a requirement: Vegan") && !t2.includes("Dietary restrictions from your earlier answers"), "after Keep+Remove: requirement card Vegan, gate gone");
      await shot(page, "v1-diet-gate-resolved", width);
      await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Last step: your starting stats" }).waitFor({ timeout: 5000 }).catch(() => {});
      const save = state.ops.find((o) => o.operation === "SAVE_INTAKE");
      rec(`v1-diet-gate@${width} advances`, (await page.getByRole("heading", { name: "Last step: your starting stats" }).count()) === 1 && save?.answers?.dietaryPattern?.pattern === "VEGAN" && save?.answers?.dietaryPattern?.mandatory === true, `advanced to step 4; saved dietaryPattern ${JSON.stringify(save?.answers?.dietaryPattern)}`);
      await page.close();
    }
    // 5. mandatory diet card
    {
      const { page } = await open(browser, width, MANDATORY, 2);
      const t = await text(page);
      rec(`mandatory-diet-card@${width}`, t.includes("On file as a requirement: Vegetarian") || /On file as a requirement: \S+/.test(t), `card text: ${(t.match(/On file as a requirement:[^\n]*/) ?? ["(missing)"])[0]}; Remove requirement button ${(await btn(page, "Remove requirement").count())}; chips hidden ${(await btn(page, /^Balanced/).count()) === 0}`);
      await audit(page, "mandatory-diet-card", width);
      await shot(page, "mandatory-diet-card", width);
      await page.close();
    }
    // 6. preference card
    {
      const { page } = await open(browser, width, PREFERENCE, 2);
      const t = await text(page);
      rec(`preference-diet-card@${width}`, /On file as a preference: Pescatarian/i.test(t) && (await btn(page, "Choose a different style").count()) === 1, `card text: ${(t.match(/On file as a preference:[^\n]*/) ?? ["(missing)"])[0]}`);
      await audit(page, "preference-diet-card", width);
      await shot(page, "preference-diet-card", width);
      await page.close();
    }
    // 7. safety labels before None, nothing pre-pressed (new client, step 4)
    {
      const { page } = await open(browser, width, null, 3, { safetyDone: false });
      const labels = ["Chest pain during exercise", "Dizziness or fainting", "A known heart condition", "Pregnant or postpartum", "A recent injury or surgery", "An age-related eligibility concern", "An eating-disorder history or concern", "Type 1 diabetes"];
      const items = await page.locator("#intake-safety-conditions li").allInnerTexts();
      const noneBtn = btn(page, /None of these apply/);
      const listBox = await page.locator("#intake-safety-conditions").boundingBox();
      const noneBox = await noneBtn.boundingBox();
      const allVisible = (await Promise.all(labels.map((l) => page.locator("#intake-safety-conditions li", { hasText: l }).isVisible()))).every(Boolean);
      const pressedNames = await page.locator('[aria-pressed="true"]').allInnerTexts();
      const anyPressed = await page.locator('div:has(> div > h3:text("Quick safety check")) [aria-pressed="true"]').count();
      rec(`safety-labels@${width}`, JSON.stringify(items) === JSON.stringify(labels) && allVisible && listBox.y + listBox.height <= noneBox.y && !(await pressed(noneBtn)) && anyPressed === 0, `8 labels in order, visible, above the None button (list bottom ${Math.round(listBox.y + listBox.height)} <= button top ${Math.round(noneBox.y)}); pressed controls in safety block: ${anyPressed} (pressed elsewhere on step: ${JSON.stringify(pressedNames)}); details expanded: ${await btn(page, /Something applies/).getAttribute("aria-expanded")}`);
      await audit(page, "safety-labels", width);
      await shot(page, "safety-labels", width);
      await page.close();
    }
    // 8. step-4 confirmed-client copy (v2 allergies, and earlier format)
    {
      const { page } = await open(browser, width, BASE, 3);
      const t = await text(page);
      rec(`step4-confirmed-copy@${width}`, t.includes("Your intake is already confirmed. Confirming again cancels any plan being prepared, even if nothing changed.") && t.includes("If you changed your allergy answers, that is also new safety information") && !t.includes("Quick safety check"), "confirmed-client note present; safety block hidden (disclosure done)");
      await audit(page, "step4-confirmed-copy", width);
      await shot(page, "step4-confirmed-copy", width);
      await page.close();
      const o = await open(browser, width, V1_ALLERGY, 3);
      const t2 = await text(o.page);
      rec(`step4-confirmed-copy-earlier-format@${width}`, t2.includes("Because your allergy answers were saved in an earlier format, they are also recorded as new safety information"), "earlier-format variant present");
      await shot(o.page, "step4-confirmed-copy-earlier-format", width);
      await o.page.close();
    }
    // 9. full flow, imperial height with inches typed before feet
    {
      const { page, state } = await open(browser, width, null, 0, { safetyDone: false });
      await btn(page, /Fat Loss \/ Cut/).click(); await btn(page, /^Intermediate/).click();
      // T-2055 check (1): Fat Loss shows the pace pills and Continue is blocked until one is chosen.
      const paceVisible = (await page.getByText("Preferred pace").count()) === 1 && (await btn(page, "Gradual").count()) === 1 && (await btn(page, "Moderate").count()) === 1 && (await btn(page, "Undecided").count()) === 1 && (await btn(page, "Maintain").count()) === 0;
      await btn(page, "Continue").click();
      await page.getByText("Choose a preferred pace, or Undecided.").waitFor({ timeout: 3000 }).catch(() => {});
      const paceBlocked = (await page.getByText("Choose a preferred pace, or Undecided.").count()) === 1 && (await page.getByRole("heading", { name: "What are we building toward?" }).count()) === 1 && state.ops.length === 0;
      rec(`fatloss-pace@${width} required`, paceVisible && paceBlocked, `Gradual/Moderate/Undecided shown, no Maintain: ${paceVisible}; Continue without a pace blocked, nothing sent: ${paceBlocked}`);
      await audit(page, "step1-fatloss-pace-required", width);
      await shot(page, "step1-fatloss-pace-required", width);
      await btn(page, "Gradual").click(); await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Set up your training week" }).waitFor();
      await btn(page, /^4 days/).click(); await btn(page, /Home Dumbbells/).click(); await btn(page, "Regular").click(); await btn(page, /^45–60m/).click(); await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Make nutrition fit your style" }).waitFor();
      await btn(page, /^High Protein/).click(); await btn(page, /^Moderate/).click(); await btn(page, /Exact Macros/).click(); await btn(page, /^None$/).click(); await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Last step: your starting stats" }).waitFor();
      const unitsImperial = await pressed(btn(page, /lb \/ ft/));
      await page.getByLabel("Additional height in inches").fill("7");
      const inchesHeld = await page.getByLabel("Additional height in inches").inputValue();
      await page.getByLabel("Height in feet").fill("5");
      const afterFeet = [await page.getByLabel("Height in feet").inputValue(), await page.getByLabel("Additional height in inches").inputValue()];
      await page.getByLabel(/Weight \(lb\)/).fill("150"); await page.getByLabel("Age").fill("34");
      await audit(page, "step4-imperial-inches-first", width);
      await shot(page, "step4-imperial-inches-first", width);
      await btn(page, /None of these apply/).click();
      await btn(page, "Confirm my answers").click();
      await page.waitForURL("http://localhost:4177/client/ai-coach", { timeout: 8000 }).catch(() => {});
      const confirm = state.ops.find((o) => o.operation === "CONFIRM_INTAKE");
      rec(`fatloss-pace@${width} confirm`, confirm?.answers?.goalStatus === "CONFIRMED" && confirm?.answers?.bodyWeightIntent === "LOSE" && confirm?.answers?.goalPaceClass === "GRADUAL" && confirm?.answers?.energyMethodPopulationCategoryStatus === "UNKNOWN" && confirm?.answers?.physicalActivityCategoryStatus === "UNKNOWN", `CONFIRM_INTAKE goal ${JSON.stringify({ s: confirm?.answers?.goalStatus, i: confirm?.answers?.bodyWeightIntent, p: confirm?.answers?.goalPaceClass, pop: confirm?.answers?.energyMethodPopulationCategoryStatus, act: confirm?.answers?.physicalActivityCategoryStatus })}`);
      rec(`imperial-inches-first@${width}`, unitsImperial && inchesHeld === "7" && afterFeet[0] === "5" && afterFeet[1] === "7" && confirm?.answers?.heightCm === 170.2, `imperial default ${unitsImperial}; inches held "${inchesHeld}"; after feet ${afterFeet.join("ft ")}in; confirmed heightCm ${confirm?.answers?.heightCm}; ops ${state.ops.map((o) => o.operation).join(">")}; trainingContext ${confirm?.answers?.trainingContextStatus}/${confirm?.answers?.resistanceTrainingContext}`);
      await page.close();
    }
    // 11. T-2055 check (2): Strength shows no pace and confirms goalStatus UNKNOWN
    {
      const { page, state } = await open(browser, width, null, 0, { safetyDone: false });
      await btn(page, /^Strength/).click(); await btn(page, /^Beginner/).click();
      const noPace = (await page.getByText("Preferred pace").count()) === 0 && (await btn(page, "Gradual").count()) === 0;
      await audit(page, "step1-strength-no-pace", width);
      await shot(page, "step1-strength-no-pace", width);
      await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Set up your training week" }).waitFor();
      await finishFromStep2(page);
      const confirm = state.ops.find((o) => o.operation === "CONFIRM_INTAKE");
      rec(`strength-no-pace@${width}`, noPace && confirm?.answers?.goalStatus === "UNKNOWN" && confirm?.answers?.goalPaceClass === undefined && confirm?.answers?.bodyWeightIntent === undefined, `no pace pills: ${noPace}; CONFIRM_INTAKE ${JSON.stringify({ g: confirm?.answers?.goal, s: confirm?.answers?.goalStatus, p: confirm?.answers?.goalPaceClass ?? null })}`);
      await page.close();
    }
    // 12. T-2055 check (3): stored OVER_90 / UNDER_30 bands round-trip
    for (const [band, label] of [["OVER_90", /^60m\+/], ["UNDER_30", /^Under 30m/]]) {
      const { page, state } = await open(browser, width, { ...BASE, sessionLengthBand: band }, 1);
      const selected = await pressed(btn(page, label));
      const pillCount = await page.locator("fieldset", { hasText: "Typical session length" }).getByRole("button").count();
      await audit(page, `step2-stored-${band}`, width);
      await shot(page, `step2-stored-${band}`, width);
      await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Make nutrition fit your style" }).waitFor();
      await btn(page, "Continue").click();
      await page.getByRole("heading", { name: "Last step: your starting stats" }).waitFor();
      await btn(page, "Confirm my answers").click();
      await page.waitForURL("http://localhost:4177/client/ai-coach", { timeout: 8000 }).catch(() => {});
      const confirm = state.ops.find((o) => o.operation === "CONFIRM_INTAKE");
      rec(`stored-band-${band}@${width}`, selected && confirm?.answers?.sessionLengthBand === band, `pill ${label} pressed: ${selected}; ${pillCount} session pills; CONFIRM_INTAKE sessionLengthBand ${confirm?.answers?.sessionLengthBand}`);
      await page.close();
    }
    // 10. permanent dark: light colour-scheme preference still renders dark
    {
      const { page } = await open(browser, width, null, 2, { colorScheme: "light" });
      await audit(page, "dark-under-light-preference", width);
      await shot(page, "dark-under-light-preference", width);
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log(`\nTOTAL ${results.length} checks, ${failures.length} failed`);
if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
