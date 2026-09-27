// T-2039 ui-qa evidence harness.
// Renders PlanDisplay with real React components against a synthetic local HTTP boundary.
// Covers the three states required in T-2039 spec:
//   (a) composed 4-day upper/lower plan from the draft catalog
//   (b) composed 2-day full-body plan at EQUIPMENT_NONE
//   (c) UNAVAILABLE result (strength: [], cardio: []), verifying degraded copy
//
// Run: DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" \
//   pnpm exec tsx tests/browser/ai-coach-training-composer-evidence.ts

import { createRequire } from "node:module";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { composeTraining } from "../../lib/ai-coach/training/index";
import { trainingCatalogSourceFromDraftFile } from "../../lib/ai-coach/training/catalog-source";
import { resolveTrainingParameters } from "../../lib/ai-coach/training/parameters";
import { buildSyntheticArtifactSet } from "../../lib/ai-coach/artifacts/synthetic-fixtures";
import { enableDraftExerciseCatalog } from "../../lib/ai-coach/catalog/draft-exercise-catalog";
import type { DraftExerciseCatalogFile } from "../../lib/ai-coach/artifacts/drafts/exercise-catalog";
import { projectDraftExerciseCatalog } from "../../lib/ai-coach/catalog/exercise-catalog";
import type { ExerciseItem } from "../../lib/ai-coach/catalog/schema";
import { planPayloadSchema, type PlanPayload } from "../../lib/ai-coach/plan-contract";
import type { PolicyBundleContent, EscalationTemplatesContent } from "../../lib/ai-coach/artifacts/schema";
const root = process.cwd();

function requireFromStore(pnpmDirGlob: string, pkgSubpath: string) {
  const storeDir = `${root}/node_modules/.pnpm`;
  const entries = readdirSync(storeDir).filter((n) => n.startsWith(pnpmDirGlob));
  if (!entries.length) throw new Error(`no pnpm store entry matching ${pnpmDirGlob}`);
  const pkgDir = `${storeDir}/${entries[0]}/node_modules/${pkgSubpath}`;
  const req = createRequire(`${pkgDir}/package.json`);
  return req(pkgSubpath);
}

const { build } = requireFromStore("esbuild@", "esbuild");

const OUT_DIR = "/Users/jadenwong/Dev/steadfast-hq/board/evidence/ui/T-2039";
mkdirSync(OUT_DIR, { recursive: true });

async function compileCss(): Promise<string> {
  const postcssStoreDir = `${root}/node_modules/.pnpm`;
  const twEntry = readdirSync(postcssStoreDir).find((n) => n.startsWith("@tailwindcss+postcss@"));
  const pkgDir = `${postcssStoreDir}/${twEntry}/node_modules/@tailwindcss/postcss`;
  const req = createRequire(`${pkgDir}/package.json`);
  const tw = req("@tailwindcss/postcss");
  const postcss = req("postcss");
  const css = readFileSync(`${root}/app/globals.css`, "utf8");
  const result = await postcss([tw()]).process(css, {
    from: `${root}/app/globals.css`,
    to: `${root}/out.css`,
  });
  return result.css;
}

async function main() {
  // 1. Prepare parameters, catalog, and draft projections
  enableDraftExerciseCatalog();
  const draftFile: DraftExerciseCatalogFile = enableDraftExerciseCatalog();
  const projectedDraftExercises: ReadonlyMap<string, ExerciseItem> = projectDraftExerciseCatalog(draftFile);
  const draftExerciseEntries = Array.from(projectedDraftExercises.entries());

  const set = buildSyntheticArtifactSet();
  const escalation = set.escalationTemplates.content as EscalationTemplatesContent;
  const explanationTexts = escalation.templates.map((t) => ({
    id: t.id,
    text: t.nextStepText,
  }));
  const resolvedParams = resolveTrainingParameters(
    set.policyBundle.content as PolicyBundleContent,
    explanationTexts
  );
  if (!resolvedParams.ok) {
    throw new Error(`Failed to resolve training parameters: ${JSON.stringify(resolvedParams)}`);
  }

  const catalogSource = trainingCatalogSourceFromDraftFile();

  // 2. Compose State (a): 4-day upper/lower split, FULL_GYM
  const resA = composeTraining(
    resolvedParams.parameters,
    catalogSource,
    resolvedParams.effortText,
    {
      intakeVersion: 2,
      trainingContextStatus: "CONFIRMED",
      activeContraindicationRuleIds: [],
      sessionLengthBand: "MIN_45_60",
      equipmentAccess: ["FULL_GYM"],
      trainingDaysPerWeek: 4,
      experienceLevel: "EXPERIENCED",
      energyReducedRelativeToMaintenance: false,
    }
  );
  if (resA.status !== "COMPOSED") {
    throw new Error(`State A composition failed: ${JSON.stringify(resA)}`);
  }

  const planA: PlanPayload = planPayloadSchema.parse({
    schemaVersion: 1,
    contentKind: "SYNTHETIC_FIXTURE",
    nutrition: null,
    meals: null,
    strength: resA.strength,
    cardio: resA.cardio,
    policyVersion: "policy-fixture-v1",
    catalogVersions: {
      food: "food-fixture-v2",
      exercise: catalogSource.catalogVersion,
    },
  });

  // 3. Compose State (b): 2-day full-body, EQUIPMENT_NONE
  const resB = composeTraining(
    resolvedParams.parameters,
    catalogSource,
    resolvedParams.effortText,
    {
      intakeVersion: 2,
      trainingContextStatus: "CONFIRMED",
      activeContraindicationRuleIds: [],
      sessionLengthBand: "MIN_30_45",
      equipmentAccess: ["NONE"],
      trainingDaysPerWeek: 2,
      experienceLevel: "NEW",
      energyReducedRelativeToMaintenance: false,
    }
  );
  if (resB.status !== "COMPOSED") {
    throw new Error(`State B composition failed: ${JSON.stringify(resB)}`);
  }

  const planB: PlanPayload = planPayloadSchema.parse({
    schemaVersion: 1,
    contentKind: "SYNTHETIC_FIXTURE",
    nutrition: null,
    meals: null,
    strength: resB.strength,
    cardio: resB.cardio,
    policyVersion: "policy-fixture-v1",
    catalogVersions: {
      food: "food-fixture-v2",
      exercise: catalogSource.catalogVersion,
    },
  });

  // 4. State (c): UNAVAILABLE result (strength: [], cardio: [])
  const planC: PlanPayload = planPayloadSchema.parse({
    schemaVersion: 1,
    contentKind: "SYNTHETIC_FIXTURE",
    nutrition: null,
    meals: null,
    strength: [],
    cardio: [],
    policyVersion: "policy-fixture-v1",
    catalogVersions: {
      food: "food-fixture-v2",
      exercise: catalogSource.catalogVersion,
    },
  });

  const plans = {
    "a-composed-4day-upper-lower": planA,
    "b-composed-2day-equipment-none": planB,
    "c-unavailable-degraded": planC,
  };

  // 5. Compile CSS & Bundle Client App with esbuild
  const css = await compileCss();

  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { PlanDisplay } from './components/ai-coach/plan-display';
        import { registerDraftExerciseCatalog } from './lib/ai-coach/catalog/exercise-catalog';

        const draftItems = new Map(${JSON.stringify(draftExerciseEntries)});
        registerDraftExerciseCatalog(draftItems);

        const plans = ${JSON.stringify(plans)};
        const key = location.pathname.replace('/', '');
        const plan = plans[key];

        createRoot(document.getElementById('root')).render(
          <div className="max-w-3xl mx-auto p-4">
            <header className="mb-6">
              <h1 className="text-2xl font-bold text-zinc-100">AI Coach Training Plan</h1>
              <p className="text-sm text-zinc-400">T-2039 Composed Training Preview: {key}</p>
            </header>
            {plan ? <PlanDisplay plan={plan} /> : <p className="text-red-400">Plan not found: {key}</p>}
          </div>
        );
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

  // 6. Launch Chromium and capture screenshots
  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const failures: string[] = [];

  try {
    const context = await browser.newContext();
    await context.route("http://localhost:4178/**", async (route) => {
      return route.fulfill({
        contentType: "text/html",
        body: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#0a0f1e;margin:0;padding:16px" class="dark"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`,
      });
    });

    const stateKeys = [
      "a-composed-4day-upper-lower",
      "b-composed-2day-equipment-none",
      "c-unavailable-degraded",
    ] as const;

    for (const key of stateKeys) {
      for (const [widthLabel, viewport] of [
        ["390", { width: 390, height: 844 }],
        ["1280", { width: 1280, height: 900 }],
      ] as const) {
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        await page.goto(`http://localhost:4178/${key}`);

        await page.getByRole("heading", { name: "AI Coach Training Plan" }).waitFor();

        const bodyText = await page.locator("body").innerText();

        if (key === "a-composed-4day-upper-lower") {
          if (
            !bodyText.includes("Day 1") ||
            !bodyText.includes("Day 2") ||
            !bodyText.includes("Day 4") ||
            !bodyText.includes("Day 6")
          ) {
            failures.push(`${key}@${widthLabel}: Missing expected 4 workout days in upper/lower split`);
          }
          if (!bodyText.includes("Dumbbell floor press")) {
            failures.push(`${key}@${widthLabel}: Missing Dumbbell floor press exercise`);
          }
          if (!bodyText.includes(resolvedParams.effortText.strength)) {
            failures.push(`${key}@${widthLabel}: Missing effort text in strength session`);
          }
        }

        if (key === "b-composed-2day-equipment-none") {
          if (!bodyText.includes("Day 1") || !bodyText.includes("Day 4")) {
            failures.push(`${key}@${widthLabel}: Missing expected 2 workout days in full-body split`);
          }
          if (!bodyText.includes("Chair squat")) {
            failures.push(`${key}@${widthLabel}: Missing Chair squat exercise for equipment none`);
          }
          if (!bodyText.includes("outdoor walk") || !bodyText.includes(resolvedParams.effortText.cardio)) {
            failures.push(`${key}@${widthLabel}: Missing outdoor walk cardio or intensity text`);
          }
        }

        if (key === "c-unavailable-degraded") {
          if (!bodyText.includes("Strength training is unavailable or paused.")) {
            failures.push(`${key}@${widthLabel}: Missing degraded strength message`);
          }
          if (!bodyText.includes("Cardio is unavailable or paused.")) {
            failures.push(`${key}@${widthLabel}: Missing degraded cardio message`);
          }
        }

        // No horizontal overflow
        if (widthLabel === "390") {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1
          );
          if (overflow) {
            failures.push(`${key}@390: horizontal overflow (scrollWidth > innerWidth)`);
          }
        }

        const screenshotPath = `${OUT_DIR}/${key}-${widthLabel}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Saved screenshot: ${screenshotPath}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error("FAIL:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }

  console.log("PASS: All 3 states x 2 widths captured successfully to " + OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
