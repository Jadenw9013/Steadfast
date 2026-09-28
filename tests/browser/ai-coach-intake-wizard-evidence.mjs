// T-2028 UI evidence harness. Mounts the real IntakeWizard against a local,
// in-memory HTTP boundary. No production auth bypass, DB, or external network.
//
// Run:
//   DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" \
//     node tests/browser/ai-coach-intake-wizard-evidence.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

function requireFromStore(pnpmDirPrefix, pkgSubpath) {
  const storeDir = `${root}/node_modules/.pnpm`;
  const entry = readdirSync(storeDir).find((name) => name.startsWith(pnpmDirPrefix));
  if (!entry) throw new Error(`no pnpm store entry matching ${pnpmDirPrefix}`);
  const pkgDir = `${storeDir}/${entry}/node_modules/${pkgSubpath}`;
  return createRequire(`${pkgDir}/package.json`)(pkgSubpath);
}

const { build } = requireFromStore("esbuild@", "esbuild");
const { chromium } = require("@playwright/test");
const OUT_DIR = "/Users/jadenwong/Dev/steadfast-hq/board/evidence/ui/T-2028";
mkdirSync(OUT_DIR, { recursive: true });

async function compileCss() {
  const storeDir = `${root}/node_modules/.pnpm`;
  const entry = readdirSync(storeDir).find((name) => name.startsWith("@tailwindcss+postcss@"));
  if (!entry) throw new Error("Tailwind PostCSS package is unavailable");
  const pkgDir = `${storeDir}/${entry}/node_modules/@tailwindcss/postcss`;
  const req = createRequire(`${pkgDir}/package.json`);
  const postcss = req("postcss");
  const css = readFileSync(`${root}/app/globals.css`, "utf8");
  return (
    await postcss([req("@tailwindcss/postcss")()]).process(css, {
      from: `${root}/app/globals.css`,
      to: `${root}/out.css`,
    })
  ).css;
}

const CONFIRMED_INTAKE = {
  intakeVersion: 2,
  goal: "BODY_COMPOSITION",
  experienceLevel: "RETURNING",
  trainingDaysPerWeek: 4,
  equipmentAccess: ["HOME_BASIC"],
  foodBudgetLevel: "MODERATE",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
  ageStatus: "CONFIRMED",
  ageYears: 34,
  energyMethodPopulationCategoryStatus: "UNKNOWN",
  physicalActivityCategoryStatus: "UNKNOWN",
  bodyMeasurementStatus: "CONFIRMED",
  heightCm: 168,
  weightKg: 63,
  weightMeasuredOn: "2026-09-27",
  goalStatus: "CONFIRMED",
  bodyWeightIntent: "LOSE",
  goalPaceClass: "UNDECIDED",
  weightNeutralAccepted: false,
  trainingContextStatus: "CONFIRMED",
  resistanceTrainingContext: "OCCASIONAL",
  sessionLengthBand: "MIN_45_60",
  cookingAccessStatus: "UNKNOWN",
  dislikes: [],
  cuisinePreferences: [],
  allergenDeclarations: {
    status: "CONFIRMED",
    noKnownAllergens: false,
    items: [
      {
        category: "TREE_NUT",
        specificity: null,
        kind: "ALLERGY",
        crossContactAvoidanceRequired: "UNSURE",
      },
    ],
  },
  dietaryPattern: {
    pattern: "OTHER",
    otherLabel: "High protein",
    mandatory: false,
    reason: "PREFERENCE",
    status: "CONFIRMED",
  },
};

const STATIC_SCENARIOS = {
  "step1-goal-empty": { confirmedIntake: null, initialStage: 0 },
  "step2-training-empty": { confirmedIntake: null, initialStage: 1 },
  "step3-nutrition-empty": { confirmedIntake: null, initialStage: 2 },
  "step4-stats-empty": { confirmedIntake: null, initialStage: 3 },
  "step1-goal-existing": { confirmedIntake: CONFIRMED_INTAKE, initialStage: 0 },
  "step3-nutrition-existing": { confirmedIntake: CONFIRMED_INTAKE, initialStage: 2 },
  "step4-stats-existing": { confirmedIntake: CONFIRMED_INTAKE, initialStage: 3 },
};

const css = await compileCss();
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { IntakeWizard } from './components/ai-coach/intake-wizard';

      const SCENARIOS = ${JSON.stringify(STATIC_SCENARIOS)};

      function Harness({ initialView, initialStage }) {
        const [view, setView] = React.useState(initialView);
        const [busy, setBusy] = React.useState(false);
        const [message, setMessage] = React.useState('');
        const [error, setError] = React.useState('');
        const refresh = React.useCallback(async () => {
          const response = await fetch('/api/client/ai-coach/workspace', { cache: 'no-store' });
          setView((await response.json()).data);
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
        const command = (input) => post('/api/client/ai-coach/commands', {
          expectedProfileRevision: view.profileRevision,
          ...input,
        });
        return React.createElement(
          'main',
          { style: { maxWidth: '48rem', margin: '0 auto' } },
          error && React.createElement('p', { role: 'alert', className: 'mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300' }, error),
          message && React.createElement('p', { role: 'status', className: 'mb-4 rounded-xl border border-emerald-500/30 p-4 text-emerald-300' }, message),
          React.createElement(IntakeWizard, { view, busy, act, command, post, initialStage })
        );
      }

      function mount(view, initialStage) {
        createRoot(document.getElementById('root')).render(
          React.createElement(Harness, { initialView: view, initialStage })
        );
      }

      window.__mountScenario = (key) => {
        const scenario = SCENARIOS[key];
        mount({ confirmedIntake: scenario.confirmedIntake, draft: null, profileRevision: 1 }, scenario.initialStage);
      };
      window.__mountLiveView = (view, initialStage = 0) => mount(view, initialStage);
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

function makeState(confirmedIntake = null) {
  return {
    confirmedIntake,
    draft: null,
    profileRevision: 1,
    operations: [],
    failConfirm: false,
  };
}

async function registerRoutes(page, state) {
  await page.route("http://localhost:4177/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/client/ai-coach/workspace") {
      return route.fulfill({
        json: {
          data: {
            confirmedIntake: state.confirmedIntake,
            draft: state.draft,
            profileRevision: state.profileRevision,
          },
        },
      });
    }
    if (pathname === "/api/client/ai-coach/commands" && request.method() === "POST") {
      const input = request.postDataJSON();
      state.operations.push(input.operation);
      if (input.operation === "CONFIRM_INTAKE" && state.failConfirm) {
        return route.fulfill({
          status: 422,
          json: { error: { message: "Please review your answers and try again." } },
        });
      }
      if (input.operation === "SAVE_INTAKE") {
        state.draft = { ...(state.draft ?? {}), ...input.answers };
      }
      if (input.operation === "ALLERGIES") {
        state.draft = {
          ...(state.draft ?? {}),
          allergenDeclarations: input.allergenDeclarations,
        };
      }
      if (input.operation === "CONFIRM_INTAKE") {
        state.confirmedIntake = {
          ...(state.confirmedIntake ?? {}),
          ...(state.draft ?? {}),
          ...input.answers,
        };
        state.draft = null;
        state.profileRevision += 1;
      }
      return route.fulfill({ json: { data: { saved: true } } });
    }
    return route.fulfill({ contentType: "text/html", body: htmlPage() });
  });
}

async function mountScenario(page, key) {
  await page.evaluate((scenario) => window.__mountScenario(scenario), key);
  await page.locator("h2").first().waitFor();
}

async function auditVisibleUi(page, name, viewport, failures) {
  if (viewport === "390") {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    if (overflows) failures.push(`${name}@390: horizontal overflow`);
  }
  for (const control of await page.locator("button:visible").all()) {
    const box = await control.boundingBox();
    if (box && box.height < 48) {
      failures.push(
        `${name}@${viewport}: button "${await control.innerText()}" is ${box.height}px`
      );
    }
  }
  for (const control of await page.locator("input:visible").all()) {
    const fontSize = await control.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize)
    );
    if (fontSize < 16) failures.push(`${name}@${viewport}: input font is ${fontSize}px`);
  }
  const text = await page.locator("body").innerText();
  for (const retired of [
    "Population category",
    "Physical activity category",
    "Cross-contact",
    "Cooking and storage",
    "species",
  ]) {
    if (text.includes(retired))
      failures.push(`${name}@${viewport}: retired copy "${retired}" is visible`);
  }
}

async function captureScenario(page, key, failures) {
  for (const [label, size] of [
    ["390", { width: 390, height: 1000 }],
    ["1280", { width: 1280, height: 1000 }],
  ]) {
    await page.setViewportSize(size);
    await page.goto("http://localhost:4177/");
    await mountScenario(page, key);
    await auditVisibleUi(page, key, label, failures);
    await page.screenshot({ path: `${OUT_DIR}/${key}-${label}.png`, fullPage: true });
  }
}

async function selectButton(page, name) {
  await page.getByRole("button", { name, exact: typeof name === "string" }).click();
}

async function completeThroughNutrition(page) {
  await selectButton(page, /Fat Loss \/ Cut/);
  await selectButton(page, "Intermediate");
  await selectButton(page, "Continue");
  await page.getByRole("heading", { name: "Set up your training week" }).waitFor();

  await selectButton(page, "4");
  await selectButton(page, /Home Dumbbells/);
  await selectButton(page, "45–60m");
  await selectButton(page, "Continue");
  await page.getByRole("heading", { name: "Make nutrition fit your style" }).waitFor();

  await selectButton(page, "High Protein");
  await selectButton(page, /Exact Macros/);
  await selectButton(page, "None");
  await selectButton(page, "Tree Nuts");
  assert.equal(
    await page.getByRole("button", { name: "None" }).getAttribute("aria-pressed"),
    "false"
  );
  await selectButton(page, "Gluten");
  await selectButton(page, "Continue");
  await page.getByRole("heading", { name: "Last step: your starting stats" }).waitFor();
}

const failures = [];
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
try {
  {
    const page = await browser.newPage();
    await registerRoutes(page, makeState());
    for (const key of Object.keys(STATIC_SCENARIOS)) {
      await captureScenario(page, key, failures);
    }
    await page.close();
    console.log(`PASS: ${Object.keys(STATIC_SCENARIOS).length} static four-step states captured`);
  }

  {
    const page = await browser.newPage();
    await registerRoutes(page, makeState());
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("http://localhost:4177/");
    await mountScenario(page, "step1-goal-empty");
    assert.equal(await page.getByRole("alert").count(), 0);
    await selectButton(page, "Continue");
    await page.getByRole("alert").filter({ hasText: "Choose your main goal" }).waitFor();
    await page.getByRole("heading", { name: "What are we building toward?" }).waitFor();
    await page.screenshot({
      path: `${OUT_DIR}/step1-validation-after-attempt-390.png`,
      fullPage: true,
    });
    console.log("PASS: validation stays quiet until Continue is attempted");
    await page.close();
  }

  {
    const page = await browser.newPage();
    const state = makeState();
    await registerRoutes(page, state);
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.goto("http://localhost:4177/");
    await mountScenario(page, "step1-goal-empty");
    await completeThroughNutrition(page);

    await page.getByLabel("Height in feet").fill("5");
    await page.getByLabel("Additional height in inches").fill("6");
    await page.getByLabel("Weight (lb)").fill("150");
    await page.getByLabel("Age").fill("34");
    await selectButton(page, /None of these apply/);
    const confirm = page.getByRole("button", { name: "Confirm & Build Plan" });
    assert.equal(await confirm.isEnabled(), true);
    await auditVisibleUi(page, "step4-complete", "390", failures);
    await page.screenshot({ path: `${OUT_DIR}/step4-complete-390.png`, fullPage: true });

    await confirm.click();
    await page.waitForURL("http://localhost:4177/client/ai-coach");
    assert.deepEqual(state.operations.slice(-3), ["SAFETY", "ALLERGIES", "CONFIRM_INTAKE"]);
    assert.equal(state.confirmedIntake.energyMethodPopulationCategoryStatus, "UNKNOWN");
    assert.equal(state.confirmedIntake.physicalActivityCategoryStatus, "UNKNOWN");
    assert.equal(state.confirmedIntake.cookingAccessStatus, "UNKNOWN");
    assert.equal(state.confirmedIntake.allergenDeclarations.items[1].specificity, "gluten");
    console.log(
      "PASS: mobile happy path confirms and redirects after SAFETY -> ALLERGIES -> CONFIRM_INTAKE"
    );
    await page.close();
  }

  {
    const page = await browser.newPage();
    const state = makeState();
    state.failConfirm = true;
    await registerRoutes(page, state);
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.goto("http://localhost:4177/");
    await mountScenario(page, "step1-goal-empty");
    await completeThroughNutrition(page);
    await page.getByLabel("Height in feet").fill("5");
    await page.getByLabel("Additional height in inches").fill("6");
    await page.getByLabel("Weight (lb)").fill("150");
    await page.getByLabel("Age").fill("34");
    await selectButton(page, /None of these apply/);
    await selectButton(page, "Confirm & Build Plan");
    await page.getByRole("alert").filter({ hasText: "Please review your answers" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(
      await page.getByRole("button", { name: "Confirm & Build Plan" }).isEnabled(),
      true
    );
    await page.screenshot({ path: `${OUT_DIR}/confirm-error-retryable-390.png`, fullPage: true });
    console.log("PASS: confirm failure stays on step 4 with visible error and retry enabled");
    await page.close();
  }

  {
    const page = await browser.newPage();
    const state = makeState();
    await registerRoutes(page, state);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("http://localhost:4177/");
    await mountScenario(page, "step1-goal-empty");
    await selectButton(page, /Fat Loss \/ Cut/);
    await selectButton(page, "Advanced");
    await selectButton(page, "Continue");
    assert.equal(state.draft.goal, "BODY_COMPOSITION");
    assert.equal(state.draft.bodyWeightIntent, "LOSE");

    await page.goto("http://localhost:4177/");
    const liveView = await page.evaluate(
      async () =>
        (await (await fetch("/api/client/ai-coach/workspace", { cache: "no-store" })).json()).data
    );
    await page.evaluate((view) => window.__mountLiveView(view, 0), liveView);
    await page.getByRole("heading", { name: "What are we building toward?" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: /Fat Loss \/ Cut/ }).getAttribute("aria-pressed"),
      "true"
    );
    assert.equal(
      await page.getByRole("button", { name: /Advanced/ }).getAttribute("aria-pressed"),
      "true"
    );
    await page.screenshot({ path: `${OUT_DIR}/resume-step1-390.png`, fullPage: true });
    console.log("PASS: saved selections rehydrate after a true page reload");
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`FAIL:\n${failures.map((failure) => ` - ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`PASS: T-2028 intake evidence captured to ${OUT_DIR}`);
