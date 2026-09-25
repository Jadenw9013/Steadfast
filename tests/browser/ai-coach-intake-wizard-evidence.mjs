// T-2024 ui-qa evidence harness. Real `IntakeWizard` component
// (components/ai-coach/intake-wizard.tsx) mounted against a synthetic HTTP
// boundary, exactly the pattern in tests/browser/ai-coach-evidence.mjs and
// tests/browser/ai-coach-ops-panel-evidence.mjs — this is a SIBLING
// harness, neither existing file is touched. No production auth bypass, no
// network I/O beyond a local Playwright-controlled page.
//
// The synthetic server mutates an in-memory draft/confirmedIntake object
// the same way the real ALLERGIES/SAVE_INTAKE/CONFIRM_INTAKE commands do
// (merge-on-save, confirm layers draft over confirmedIntake, bumps
// profileRevision) so interaction flows (reload mid-wizard, edit one stage
// of a confirmed v2 intake) exercise the real rehydration logic in
// intake-wizard.tsx, not a canned screenshot. It does not re-implement
// server-side zod validation — this is a UI harness, not an integration
// test.
//
// Run: DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" \
//   node tests/browser/ai-coach-intake-wizard-evidence.mjs
// (DATABASE_URL is not read by this script — no DB, no Prisma, no server
// action is touched — but is set per the standing rule for any
// Playwright/dev-server invocation in this repo.)
import { createRequire } from "node:module";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const root = process.cwd();

function requireFromStore(pnpmDirPrefix, pkgSubpath) {
  const storeDir = `${root}/node_modules/.pnpm`;
  const entries = readdirSync(storeDir).filter((n) => n.startsWith(pnpmDirPrefix));
  if (!entries.length) throw new Error(`no pnpm store entry matching ${pnpmDirPrefix}`);
  const pkgDir = `${storeDir}/${entries[0]}/node_modules/${pkgSubpath}`;
  const req = createRequire(`${pkgDir}/package.json`);
  return req(pkgSubpath);
}
const { build } = requireFromStore("esbuild@", "esbuild");
const { chromium } = require("@playwright/test");

const OUT_DIR = "/Users/jadenwong/Dev/steadfast-hq/board/evidence/ui/T-2024";
mkdirSync(OUT_DIR, { recursive: true });

async function compileCss() {
  const storeDir = `${root}/node_modules/.pnpm`;
  const twEntry = readdirSync(storeDir).find((n) => n.startsWith("@tailwindcss+postcss@"));
  const pkgDir = `${storeDir}/${twEntry}/node_modules/@tailwindcss/postcss`;
  const req = createRequire(`${pkgDir}/package.json`);
  const tw = req("@tailwindcss/postcss");
  const postcss = req("postcss");
  const css = readFileSync(`${root}/app/globals.css`, "utf8");
  const result = await postcss([tw()]).process(css, { from: `${root}/app/globals.css`, to: `${root}/out.css` });
  return result.css;
}

// ---------- A fully-confirmed v2 intake (SYNTHETIC), used as the seed for
// "complete stage" and interaction (reload / edit-confirmed) scenarios. ----------
const FULL_CONFIRMED_INTAKE = {
  intakeVersion: 2,
  goal: "BODY_COMPOSITION",
  experienceLevel: "RETURNING",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
  foodBudgetLevel: "MODERATE",
  trainingDaysPerWeek: 4,
  equipmentAccess: ["HOME_BASIC"],
  ageStatus: "CONFIRMED",
  ageYears: 34,
  energyMethodPopulationCategoryStatus: "CONFIRMED",
  energyMethodPopulationCategory: "FEMALE_ADULT",
  physicalActivityCategoryStatus: "CONFIRMED",
  physicalActivityCategory: "ACTIVE",
  bodyMeasurementStatus: "CONFIRMED",
  heightCm: 168,
  weightKg: 63,
  weightMeasuredOn: "2026-09-20",
  goalStatus: "CONFIRMED",
  bodyWeightIntent: "LOSE",
  goalPaceClass: "GRADUAL",
  weightNeutralAccepted: false,
  trainingContextStatus: "CONFIRMED",
  resistanceTrainingContext: "REGULAR",
  sessionLengthBand: "MIN_45_60",
  cookingAccessStatus: "CONFIRMED",
  cookingAccess: {
    equipment: ["STOVETOP", "OVEN"],
    refrigeration: "FRIDGE_AND_FREEZER",
    mealPrepCapacity: "SOME",
    typicalPrepMinutesBand: "MIN_15_30",
  },
  dislikes: [{ label: "cilantro", canonicalFoodId: null }],
  cuisinePreferences: ["Thai", "Mexican"],
  allergenDeclarations: {
    status: "CONFIRMED",
    noKnownAllergens: false,
    items: [
      { category: "TREE_NUT", specificity: "cashew", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" },
      { category: "OTHER", specificity: "sulfites", kind: "INTOLERANCE_OR_SENSITIVITY", crossContactAvoidanceRequired: "UNSURE" },
    ],
  },
  dietaryPattern: {
    pattern: "VEGAN",
    otherLabel: null,
    mandatory: true,
    reason: "PREFERENCE",
    status: "CONFIRMED",
  },
};

// Mixed intake with several statuses left UNKNOWN — required scalars and
// the invariant-checked groups (training days/equipment, allergens,
// dietary pattern) are answered so `reviewBlockingIssues` is empty and
// Confirm is reachable, but several *governed* groups stay UNKNOWN so the
// review stage's plain-language pending notice has real content.
const MIXED_UNKNOWN_INTAKE = {
  intakeVersion: 2,
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trackingPreference: "PORTIONS_ONLY",
  unitsPreference: "IMPERIAL",
  foodBudgetLevel: "LOW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE"],
  ageStatus: "UNKNOWN",
  energyMethodPopulationCategoryStatus: "UNKNOWN",
  physicalActivityCategoryStatus: "DECLINED",
  bodyMeasurementStatus: "UNKNOWN",
  goalStatus: "CONFIRMED",
  bodyWeightIntent: "MAINTAIN",
  goalPaceClass: "MAINTAIN",
  weightNeutralAccepted: true,
  trainingContextStatus: "UNKNOWN",
  cookingAccessStatus: "DECLINED",
  dislikes: [],
  cuisinePreferences: [],
  allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
  dietaryPattern: { pattern: "NONE_DECLARED", otherLabel: null, mandatory: false, reason: "NOT_STATED", status: "UNKNOWN" },
};

// ---------- Static (no server interaction needed) scenarios, selected by key. ----------
const STATIC_SCENARIOS = {
  "stage1-eligibility-empty": { confirmedIntake: null, draft: null, initialStage: 0 },
  "stage2-about-you-empty": { confirmedIntake: null, draft: null, initialStage: 1 },
  "stage2-about-you-complete": { confirmedIntake: FULL_CONFIRMED_INTAKE, draft: null, initialStage: 1 },
  "stage3-food-empty": { confirmedIntake: null, draft: null, initialStage: 2 },
  "stage3-food-declarations": { confirmedIntake: FULL_CONFIRMED_INTAKE, draft: null, initialStage: 2 },
  "stage4-training-empty": { confirmedIntake: null, draft: null, initialStage: 3 },
  "stage4-training-complete": { confirmedIntake: FULL_CONFIRMED_INTAKE, draft: null, initialStage: 3 },
  "stage5-review-complete": { confirmedIntake: FULL_CONFIRMED_INTAKE, draft: null, initialStage: 4 },
  "stage5-review-mixed-unknown": { confirmedIntake: MIXED_UNKNOWN_INTAKE, draft: null, initialStage: 4 },
};

const css = await compileCss();
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { IntakeWizard } from './components/ai-coach/intake-wizard';

      const SCENARIOS = ${JSON.stringify(STATIC_SCENARIOS)};

      // Same act/command/post wrapper shape as components/ai-coach/experience.tsx
      // (the real caller of IntakeWizard), against the synthetic HTTP boundary
      // registered by the Node driver below.
      function Harness({ initialView, forceInitialStage }) {
        const [view, setView] = React.useState(initialView);
        const [busy, setBusy] = React.useState(false);
        const [message, setMessage] = React.useState('');
        const [error, setError] = React.useState('');
        const refresh = React.useCallback(async () => {
          const res = await fetch('/api/client/ai-coach/workspace', { cache: 'no-store' });
          const body = await res.json();
          setView(body.data);
        }, []);
        async function post(url, input) {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, requestKey: crypto.randomUUID() }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error?.message ?? 'This change was not confirmed. Please try again.');
          return result.data;
        }
        async function act(work, success) {
          if (busy) return;
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await work();
            setMessage(success);
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Connection interrupted. Your inputs are still here.');
          } finally {
            setBusy(false);
          }
        }
        const command = (input) =>
          post('/api/client/ai-coach/commands', { expectedProfileRevision: view.profileRevision, ...input });
        return React.createElement(
          'div',
          { style: { maxWidth: '48rem', margin: '0 auto' } },
          error && React.createElement('p', { role: 'alert', className: 'rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300', style: { marginBottom: '1rem' } }, error),
          message && React.createElement('p', { role: 'status', className: 'rounded-xl border border-emerald-500/30 p-4 text-emerald-300', style: { marginBottom: '1rem' } }, message),
          React.createElement(IntakeWizard, {
            view,
            busy,
            act,
            command,
            post,
            initialStage: forceInitialStage ?? 0,
          })
        );
      }

      function mountFromView(view, initialStage) {
        const root = createRoot(document.getElementById('root'));
        root.render(React.createElement(Harness, { initialView: view, forceInitialStage: initialStage }));
        return root;
      }
      // Mount a named static scenario (no prior server interaction).
      window.__mountHarness = (scenarioKey, forceInitialStage) => {
        const scenario = SCENARIOS[scenarioKey] ?? { confirmedIntake: null, draft: null, initialStage: 0 };
        return mountFromView(
          { confirmedIntake: scenario.confirmedIntake, draft: scenario.draft, profileRevision: 1 },
          forceInitialStage ?? scenario.initialStage ?? 0
        );
      };
      // Mount directly from a live workspace 'view' object fetched from the synthetic
      // workspace route — this is the real production entry point used after
      // a reload (defaultAnswers merging confirmedIntake then draft).
      window.__mountLiveView = (view, initialStage) => mountFromView(view, initialStage ?? 0);
    `,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
});

function htmlPage() {
  return `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#09090b;margin:0;padding:16px"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
}

// ---------- Synthetic server state, one per interactive page. Mirrors the
// real merge-on-save / confirm-layers-draft-over-confirmed semantics of
// SAVE_INTAKE / ALLERGIES / CONFIRM_INTAKE (lib/ai-coach/client-commands.ts,
// lib/ai-coach/intake.ts) closely enough to exercise the client's
// rehydration logic. ----------
function makeServerState(seed) {
  return { confirmedIntake: seed.confirmedIntake ?? null, draft: seed.draft ?? null, profileRevision: 1 };
}

async function registerCommandRoute(page, state) {
  await page.route("http://localhost:4177/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/api/client/ai-coach/workspace") {
      return route.fulfill({
        json: { data: { confirmedIntake: state.confirmedIntake, draft: state.draft, profileRevision: state.profileRevision } },
      });
    }
    if (url.pathname === "/api/client/ai-coach/concerns") {
      return route.fulfill({ json: { data: { saved: true } } });
    }
    if (url.pathname === "/api/client/ai-coach/commands" && req.method() === "POST") {
      const input = req.postDataJSON();
      if (input.operation === "SAVE_INTAKE") {
        state.draft = { ...(state.draft ?? {}), ...input.answers };
      } else if (input.operation === "ALLERGIES") {
        state.draft = { ...(state.draft ?? {}), allergenDeclarations: input.allergenDeclarations };
      } else if (input.operation === "SAFETY") {
        // no draft field affected in this synthetic boundary
      } else if (input.operation === "CONFIRM_INTAKE") {
        state.confirmedIntake = { ...(state.confirmedIntake ?? {}), ...(state.draft ?? {}), ...input.answers };
        state.draft = null;
        state.profileRevision += 1;
      }
      return route.fulfill({ json: { data: { saved: true, profileRevision: state.profileRevision }, requestId: "req-1" } });
    }
    return route.fulfill({ contentType: "text/html", body: htmlPage() });
  });
}

async function checkAccessibilityAndCopy(page, namePrefix, widthLabel, failures) {
  if (widthLabel === "390") {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) failures.push(`${namePrefix}@390: horizontal overflow`);
  }
  const buttons = await page.locator("button:visible").all();
  for (const btn of buttons) {
    const box = await btn.boundingBox();
    const label = (await btn.innerText().catch(() => "")).trim();
    if (box && box.height < 48) failures.push(`${namePrefix}@${widthLabel}: button "${label}" height ${box.height} < 48px`);
  }
  const inputs = await page.locator("input:visible, select:visible").all();
  for (const inp of inputs) {
    const fontSize = await inp.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (fontSize < 16) failures.push(`${namePrefix}@${widthLabel}: input font-size ${fontSize}px < 16px`);
  }
  const bodyText = await page.locator("body").innerText();
  if (/UNVERIFIABLE_ALLERGEN_STATUS_NOT_CONFIRMED/.test(bodyText)) failures.push(`${namePrefix}@${widthLabel}: sentinel leaked to UI`);
  if (/PENDING_G01_WORDING/.test(bodyText)) failures.push(`${namePrefix}@${widthLabel}: raw PENDING_G01_WORDING token leaked to UI (expected the neutral label text)`);
  const rawTokens = (bodyText.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []).filter((t) => t !== "PENDING_G01_WORDING");
  if (rawTokens.length) failures.push(`${namePrefix}@${widthLabel}: possible raw enum identifier(s) in copy: ${[...new Set(rawTokens)].join(", ")}`);
}

async function screenshotStaticScenario(page, scenarioKey, namePrefix, failures) {
  for (const [widthLabel, viewport] of [
    ["390", { width: 390, height: 1100 }],
    ["1280", { width: 1280, height: 1100 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate((key) => {
      document.getElementById("root").innerHTML = "";
      window.__mountHarness(key);
    }, scenarioKey);
    await page.locator("h2").first().waitFor();
    await checkAccessibilityAndCopy(page, namePrefix, widthLabel, failures);
    await page.screenshot({ path: `${OUT_DIR}/${namePrefix}-${widthLabel}.png`, fullPage: true });
  }
}

const failures = [];
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
try {
  // ---------- Static states: each of the five stages, empty and complete
  // variants, and the review stage's mixed-UNKNOWN pending notice. ----------
  {
    const page = await browser.newPage();
    const state = makeServerState({});
    await registerCommandRoute(page, state);
    await page.goto("http://localhost:4177/");
    for (const key of Object.keys(STATIC_SCENARIOS)) {
      await screenshotStaticScenario(page, key, key, failures);
    }
    await page.close();
    console.log(`PASS: ${Object.keys(STATIC_SCENARIOS).length} static wizard states captured`);
  }

  // ---------- Stage 1: one UNSURE selected, then "Save selected concern now" ----------
  {
    const page = await browser.newPage();
    const state = makeServerState({});
    await registerCommandRoute(page, state);
    await page.goto("http://localhost:4177/");
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => {
      document.getElementById("root").innerHTML = "";
      window.__mountHarness("stage1-eligibility-empty", 0);
    });
    await page.getByLabel("Chest pain during exercise?").selectOption("UNSURE");
    await checkAccessibilityAndCopy(page, "stage1-eligibility-unsure-selected", "390", failures);
    await page.screenshot({ path: `${OUT_DIR}/stage1-eligibility-unsure-selected-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({ path: `${OUT_DIR}/stage1-eligibility-unsure-selected-1280.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.getByRole("button", { name: "Save selected concern now" }).click();
    await page.getByRole("status").filter({ hasText: /Concern saved/ }).waitFor();
    await page.screenshot({ path: `${OUT_DIR}/stage1-eligibility-concern-saved-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({ path: `${OUT_DIR}/stage1-eligibility-concern-saved-1280.png`, fullPage: true });
    console.log("PASS: eligibility UNSURE selection and independent concern save");
    await page.close();
  }

  // ---------- Cuisine-over-limit message (Food stage) ----------
  {
    const page = await browser.newPage();
    const state = makeServerState({});
    await registerCommandRoute(page, state);
    await page.goto("http://localhost:4177/");
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.evaluate(() => {
      document.getElementById("root").innerHTML = "";
      window.__mountHarness("stage3-food-empty", 2);
    });
    const elevenCuisines = Array.from({ length: 11 }, (_, i) => `Cuisine${i + 1}`).join(", ");
    await page.getByLabel(/Cuisines you enjoy/).fill(elevenCuisines);
    await page.locator("h2").first().waitFor();
    const bodyText = await page.locator("body").innerText();
    assert.match(bodyText, /Cuisines you enjoy: choose at most 10\./, "cuisine-over-limit message must appear");
    const continueBtn = page.getByRole("button", { name: "Continue" });
    assert.equal(await continueBtn.isDisabled(), true, "Continue must be disabled over the cuisine limit");
    await page.screenshot({ path: `${OUT_DIR}/stage3-food-cuisine-over-limit-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.screenshot({ path: `${OUT_DIR}/stage3-food-cuisine-over-limit-1280.png`, fullPage: true });
    console.log("PASS: cuisine-over-limit (11 entries) blocks Continue with a named message");
    await page.close();
  }

  // ---------- Declaration added while allergen status reads "Not sure" (self-repair) ----------
  {
    const page = await browser.newPage();
    const state = makeServerState({});
    await registerCommandRoute(page, state);
    await page.goto("http://localhost:4177/");
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.evaluate(() => {
      document.getElementById("root").innerHTML = "";
      window.__mountHarness("stage3-food-empty", 2);
    });
    const allergySection = page.locator("h3", { hasText: "Allergy disclosures" }).locator("..");
    const statusSelect = allergySection.getByLabel("Status");
    await statusSelect.selectOption("UNKNOWN");
    assert.equal(await statusSelect.inputValue(), "UNKNOWN");
    await page.screenshot({ path: `${OUT_DIR}/stage3-allergen-notsure-before-390.png`, fullPage: true });
    await page.getByRole("button", { name: "Add a declaration" }).click();
    await page.locator("h2").first().waitFor();
    const statusAfter = await statusSelect.inputValue();
    assert.equal(statusAfter, "CONFIRMED", "adding a declaration while status is Not sure must self-repair to CONFIRMED");
    await checkAccessibilityAndCopy(page, "stage3-allergen-notsure-after-add", "390", failures);
    await page.screenshot({ path: `${OUT_DIR}/stage3-allergen-notsure-after-add-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.screenshot({ path: `${OUT_DIR}/stage3-allergen-notsure-after-add-1280.png`, fullPage: true });
    console.log("PASS: allergen status self-repair UNKNOWN -> CONFIRMED on Add a declaration");
    await page.close();
  }

  // ---------- Reload mid-wizard: a saved draft rehydrates, no stage renders empty ----------
  {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.error("PAGEERROR(reload-mid-wizard):", err));
    const state = makeServerState({});
    await registerCommandRoute(page, state);
    await page.goto("http://localhost:4177/");
    await page.setViewportSize({ width: 390, height: 1300 });
    await page.evaluate(() => {
      document.getElementById("root").innerHTML = "";
      window.__mountHarness("stage2-about-you-empty", 1);
    });
    await page.locator("h2").first().waitFor();
    // Fill and save stage 2 (About you).
    await page.getByLabel("Goal").first().selectOption("STRENGTH");
    await page.getByLabel("Training experience").selectOption("EXPERIENCED");
    await page.getByLabel("Preferred nutrition display").selectOption("NUMBERS_VISIBLE");
    await page.getByLabel("Preferred units").selectOption("METRIC");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("status").filter({ hasText: /Saved/ }).waitFor();
    // Now on stage 3 (Food) — fill and save.
    await page.getByLabel("Food budget").selectOption("FLEXIBLE");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("status").filter({ hasText: /Saved/ }).waitFor();
    assert.ok(state.draft, "draft must exist on the synthetic server after two stage saves");
    assert.equal(state.draft.goal, "STRENGTH");
    assert.equal(state.draft.foodBudgetLevel, "FLEXIBLE");

    // True reload: fresh navigation + fresh document, same server-side
    // `state` (the draft persists server-side exactly as a real reload
    // would re-fetch it from the workspace route), then mount straight
    // from the live GET response — the real production init path.
    await page.goto("http://localhost:4177/");
    const liveView = await page.evaluate(async () => {
      const res = await fetch("/api/client/ai-coach/workspace", { cache: "no-store" });
      return (await res.json()).data;
    });
    assert.equal(liveView.draft.goal, "STRENGTH", "reloaded workspace GET must return the saved draft");
    assert.equal(liveView.draft.foodBudgetLevel, "FLEXIBLE");
    await page.evaluate((view) => {
      document.getElementById("root").innerHTML = "";
      window.__mountLiveView(view, 1);
    }, liveView);
    await page.locator("h2").first().waitFor();
    // Stage 2 (About you) values must have rehydrated, not be blank.
    assert.equal(await page.getByLabel("Goal").first().inputValue(), "STRENGTH");
    assert.equal(await page.getByLabel("Training experience").inputValue(), "EXPERIENCED");
    await checkAccessibilityAndCopy(page, "reload-mid-wizard-stage2-rehydrated", "390", failures);
    await page.screenshot({ path: `${OUT_DIR}/reload-mid-wizard-stage2-rehydrated-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1300 });
    await page.screenshot({ path: `${OUT_DIR}/reload-mid-wizard-stage2-rehydrated-1280.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 1300 });
    // Advance to stage 3 (Food) — must also be rehydrated, not empty.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "3. Food" }).waitFor();
    assert.equal(await page.getByLabel("Food budget").inputValue(), "FLEXIBLE");
    await page.screenshot({ path: `${OUT_DIR}/reload-mid-wizard-stage3-rehydrated-390.png`, fullPage: true });
    console.log("PASS: reload mid-wizard rehydrates both saved stages, no stage renders empty");
    await page.close();
  }

  // ---------- Edit one stage of an already-confirmed v2 intake: other stages keep their answers ----------
  {
    const page = await browser.newPage();
    const state = makeServerState({ confirmedIntake: FULL_CONFIRMED_INTAKE });
    await registerCommandRoute(page, state);
    await page.goto("http://localhost:4177/");
    await page.setViewportSize({ width: 390, height: 1300 });
    await page.evaluate(() => {
      document.getElementById("root").innerHTML = "";
      window.__mountHarness("stage2-about-you-complete", 1);
    });
    assert.equal(await page.getByLabel("Goal").first().inputValue(), "BODY_COMPOSITION");
    await page.getByLabel("Goal").first().selectOption("ENDURANCE");
    await page.screenshot({ path: `${OUT_DIR}/edit-confirmed-stage2-goal-changed-390.png`, fullPage: true });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("status").filter({ hasText: /Saved/ }).waitFor();
    // Server draft now holds only the stage-2 SAVE_INTAKE keys.
    assert.equal(state.draft.goal, "ENDURANCE");
    assert.equal(state.confirmedIntake.dietaryPattern.pattern, "VEGAN", "confirmedIntake must be untouched by the stage-2 save");

    // Simulate the real reload/remount a client would see returning to the
    // wizard: fetch the live view and mount fresh from it.
    await page.goto("http://localhost:4177/");
    const liveView = await page.evaluate(async () => {
      const res = await fetch("/api/client/ai-coach/workspace", { cache: "no-store" });
      return (await res.json()).data;
    });
    assert.equal(liveView.confirmedIntake.dietaryPattern.pattern, "VEGAN");
    assert.equal(liveView.draft.goal, "ENDURANCE");
    await page.evaluate((view) => {
      document.getElementById("root").innerHTML = "";
      window.__mountLiveView(view, 1);
    }, liveView);
    await page.locator("h2").first().waitFor();
    assert.equal(await page.getByLabel("Goal").first().inputValue(), "ENDURANCE", "edited stage keeps the edited value after remount");
    await checkAccessibilityAndCopy(page, "edit-confirmed-stage2-after-remount", "390", failures);
    await page.screenshot({ path: `${OUT_DIR}/edit-confirmed-stage2-after-remount-390.png`, fullPage: true });

    // Stage 3 (Food) must still show the ORIGINAL confirmed answers — this
    // is the exact blocker r1/r2 failed review on.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "3. Food" }).waitFor();
    const foodPageText = await page.locator("body").innerText();
    assert.match(foodPageText, /Vegan/i, "Food stage must still show the original VEGAN dietary pattern");
    assert.equal(await page.getByLabel("Food budget").inputValue(), "MODERATE", "Food stage must keep its original value, unaffected by the stage-2-only save");
    await page.screenshot({ path: `${OUT_DIR}/edit-confirmed-stage3-unchanged-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1300 });
    await page.screenshot({ path: `${OUT_DIR}/edit-confirmed-stage3-unchanged-1280.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 1300 });

    // Stage 4 (Training) must also still show its original answers.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "4. Training" }).waitFor();
    assert.equal(await page.getByLabel(/Available training days/).inputValue(), "4", "Training stage must keep its original value");
    await page.screenshot({ path: `${OUT_DIR}/edit-confirmed-stage4-unchanged-390.png`, fullPage: true });
    console.log("PASS: editing one stage of a confirmed v2 intake preserves every other stage's answers");
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("FAIL:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`PASS: intake wizard states captured to ${OUT_DIR}`);
