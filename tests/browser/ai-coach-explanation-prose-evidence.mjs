// T-2030 ui-qa evidence harness. Real React component (AiCoachExperience) mounted against a
// synthetic HTTP boundary, exactly the pattern in tests/browser/ai-coach-evidence.mjs and
// tests/browser/ai-coach-ops-panel-evidence.mjs — this is a SIBLING harness, the existing files
// are untouched. No production auth bypass, no network I/O beyond a local Playwright-controlled
// page, no DB.
//
// Renders the proposal screen (`components/ai-coach/experience.tsx:545-616`,
// `screen === "proposals"`) with fixture `AiWorkspace` props covering the five states named in
// T-2030's spec (## ui-qa (required)) and T-2006's parent spec:
//   (a) accepted prose under "Automated explanation"
//   (b) rejected prose -> falls back to the run's template decision.explanation
//   (c) no run decision at all -> no block, no empty paragraph
//   (d) FOCUSED_CLARIFICATION with clarification absent (always null server-side today, T-2011)
//       -> the approved template sentence renders, not a blank
//   (e) prose at the 400-character ceiling, checked for clean wrap / no truncation at 390px
//
// Fixture shapes are taken verbatim from tests/unit/ai-coach-experience.test.ts's
// `proposalWith`/`initial` builders (the same fixtures the SSR regression in code review r2
// finding 4 exercises), so this harness runs the identical states through a real browser.
//
// Run: DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" \
//   node tests/browser/ai-coach-explanation-prose-evidence.mjs
// (DATABASE_URL is not read by this script — no DB, no Prisma, no server action is touched —
// but is set per the standing rule for any Playwright/dev-server invocation in this repo.)
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const root = process.cwd();

// esbuild and postcss/@tailwindcss-postcss are transitive-only in this worktree's node_modules
// (not hoisted to the top level), so resolve them through their own package directories inside
// the pnpm virtual store instead of `require('esbuild')` / `require('postcss')` directly.
function requireFromStore(pnpmDirGlob, pkgSubpath) {
  const { readdirSync } = require('node:fs');
  const storeDir = `${root}/node_modules/.pnpm`;
  const entries = readdirSync(storeDir).filter(n => n.startsWith(pnpmDirGlob));
  if (!entries.length) throw new Error(`no pnpm store entry matching ${pnpmDirGlob}`);
  const pkgDir = `${storeDir}/${entries[0]}/node_modules/${pkgSubpath}`;
  const req = createRequire(`${pkgDir}/package.json`);
  return req(pkgSubpath);
}
const { build } = requireFromStore('esbuild@', 'esbuild');
const { chromium } = require('@playwright/test');

const OUT_DIR = '/Users/jadenwong/Dev/steadfast-hq/board/evidence/ui/T-2030';
mkdirSync(OUT_DIR, { recursive: true });

async function compileCss() {
  const postcssStoreDir = `${root}/node_modules/.pnpm`;
  const { readdirSync } = require('node:fs');
  const twEntry = readdirSync(postcssStoreDir).find(n => n.startsWith('@tailwindcss+postcss@'));
  const pkgDir = `${postcssStoreDir}/${twEntry}/node_modules/@tailwindcss/postcss`;
  const req = createRequire(`${pkgDir}/package.json`);
  const tw = req('@tailwindcss/postcss');
  const postcss = req('postcss');
  const css = readFileSync(`${root}/app/globals.css`, 'utf8');
  const result = await postcss([tw()]).process(css, { from: `${root}/app/globals.css`, to: `${root}/out.css` });
  return result.css;
}

const css = await compileCss();

// The bundle builds the real fixture plan in-browser via `buildInitialFixturePlan` (the same
// dependency-free helper tests/unit/ai-coach-experience.test.ts uses) so the numeric target
// shown on the plan card and the number quoted in the prose come from ONE computation — this
// is what proves state (a)/(e)'s "a number shown in the prose matches the number on the plan
// card exactly" via the shared formatter (`lib/ai-coach/numeric-display.ts`), not by hand-typing
// the same digits twice in this harness.
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AiCoachExperience } from './components/ai-coach/experience';
      import { planPayloadSchema } from './lib/ai-coach/plan-contract';
      import { formatNumericDisplayValue } from './lib/ai-coach/numeric-display';

      // Hand-built fixture plan validated by the REAL plan-contract schema
      // (plan-contract.ts imports only ./catalog/loader — no @/lib/db, safe to bundle for the
      // browser). Deliberately non-integer targets (proteinG/carbsG/fatG) so
      // formatNumericDisplayValue's .toFixed(1) path is exercised, matching
      // tests/unit/ai-coach-experience.test.ts's own formatter regression.
      const fixturePlan = planPayloadSchema.parse({
        schemaVersion: 1, contentKind: 'SYNTHETIC_FIXTURE',
        nutrition: {
          prescriptionId: 'synthetic-rx-uiqa', method: 'SYNTHETIC_CATALOG_MATCH',
          targets: { energyKcal: 1314, proteinG: 123.45, carbsG: 140, fatG: 45 },
          tolerancePercent: 5, assumptions: ['Synthetic fixture only, not a dietary recommendation.'],
        },
        meals: null, strength: [], cardio: [],
        policyVersion: 'policy-fixture-v1',
        catalogVersions: { food: 'food-fixture-v2', exercise: 'exercise-fixture-v1' },
      });
      const energyToken = formatNumericDisplayValue(fixturePlan.nutrition.targets.energyKcal);
      const proteinToken = formatNumericDisplayValue(fixturePlan.nutrition.targets.proteinG);
      window.__fixtureNumericTokens = { energyToken, proteinToken };

      const initial = {
        schemaVersion: 1,
        experience: { mode: 'SYNTHETIC', disclosure: null },
        substitutions: [],
        origin: 'AI',
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 0,
        safetyRevision: 0,
        confirmedIntake: null,
        draft: null,
        reviewTimezone: 'America/Los_Angeles',
        permissions: { nutrition: 'ALLOW', strength: 'ALLOW', cardio: 'ALLOW' },
        safetyDisposition: 'CLEAR',
        activePlan: null,
        proposals: [],
        runs: [],
      };
      function proposalWith(overrides) {
        return {
          id: 'prop-1', status: 'READY', payload: fixturePlan,
          authorization: {
            outcome: 'APPROVE_AUTOMATICALLY', reasonCodes: [], nextActionTemplateId: null,
            interpretation: null, explanation: null, clarification: null,
          },
          expectedBaseVersionId: null, expectedContextRevision: 1, expectedProfileRevision: 1,
          expectedObservationRevision: 0, expectedSafetyRevision: 0,
          ...overrides,
        };
      }
      // ceiling text: hits the 400-character contract ceiling
      // (T-2006 spec, "explanation": "string, 40-400 chars") while still quoting only the
      // server-rendered numeric token, never a fabricated number.
      const filler = 'This bounded explanation restates only validated fields from your plan and nothing else. ';
      let ceilingText = 'SYNTHETIC FIXTURE: your energy target is ' + energyToken + ' kcal per day, with ' + proteinToken + ' g of protein to support training. ';
      while (ceilingText.length < 400) ceilingText += filler;
      ceilingText = ceilingText.slice(0, 400).replace(/\\s+\\S*$/, '.');

      const states = {
        'a-accepted': {
          ...initial,
          proposals: [proposalWith({
            authorization: {
              outcome: 'APPROVE_AUTOMATICALLY', reasonCodes: [], nextActionTemplateId: null,
              interpretation: null,
              explanation: { text: 'SYNTHETIC FIXTURE: your energy target is ' + energyToken + ' kcal per day, with ' + proteinToken + ' g of protein to support training.', kind: 'MODEL_VALIDATED' },
              clarification: null,
            },
          })],
        },
        'b-rejected-template': {
          ...initial,
          proposals: [proposalWith({})],
          runs: [{
            id: 'run-1', kind: 'INITIAL', status: 'COMPLETED', createdAt: new Date().toISOString(),
            resultPlanVersionId: 'prop-1',
            decision: {
              action: 'HOLD', reasonCodes: ['INITIAL_FIXTURE'],
              explanation: 'TEMPLATE FIXTURE: your synthetic proposal is ready for review.',
              limitations: [], nextAction: 'Review the proposal.', changeClass: 'INITIAL',
            },
            failureMessage: null,
          }],
        },
        'c-no-run': {
          ...initial,
          proposals: [proposalWith({})],
          runs: [],
        },
        'd-clarification-absent': {
          ...initial,
          proposals: [proposalWith({
            status: 'FOCUSED_CLARIFICATION', payload: null,
            authorization: {
              outcome: 'FOCUSED_CLARIFICATION', reasonCodes: ['PROVIDER_CLARIFICATION_REQUESTED'],
              nextActionTemplateId: null, interpretation: null, explanation: null, clarification: null,
            },
          })],
        },
        'e-ceiling-400': {
          ...initial,
          proposals: [proposalWith({
            authorization: {
              outcome: 'APPROVE_AUTOMATICALLY', reasonCodes: [], nextActionTemplateId: null,
              interpretation: null,
              explanation: { text: ceilingText, kind: 'MODEL_VALIDATED' },
              clarification: null,
            },
          })],
        },
      };
      window.__states = states;
      window.__ceilingLength = ceilingText.length;
      const key = location.pathname.replace('/', '');
      createRoot(document.getElementById('root')).render(
        <AiCoachExperience initial={states[key]} path={['proposals', 'prop-1']} />
      );
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
  // next/link pulls in the App Router client runtime, which reads other
  // `process.env.*`/`process.*` fields our narrow `define` above does not cover and which
  // therefore throw `process is not defined` in a plain browser bundle with no Node shim. This
  // harness has no router (fixed `path` prop), so a plain <a> is behaviourally identical for
  // every assertion here (tap target, focus, text). Swap it for a minimal shim instead of
  // pulling in next/link's runtime.
  plugins: [{
    name: 'stub-next-link',
    setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link-stub', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        resolveDir: root,
        contents: `
          import React from 'react';
          export default function Link({ href, children, ...rest }) {
            return React.createElement('a', { href, ...rest }, children);
          }
        `,
        loader: 'jsx',
      }));
    },
  }],
});

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
let failures = [];
let findings = []; // pre-existing/out-of-scope observations that don't block this ticket's verdict
try {
  const context = await browser.newContext();
  await context.route('http://localhost:4177/**', async route => {
    return route.fulfill({
      contentType: 'text/html',
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#0a0f1e;margin:0;padding:16px" class="dark"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`,
    });
  });

  const stateKeys = ['a-accepted', 'b-rejected-template', 'c-no-run', 'd-clarification-absent', 'e-ceiling-400'];

  for (const key of stateKeys) {
    for (const [widthLabel, viewport] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      await page.goto(`http://localhost:4177/${key}`);
      await page.getByRole('heading', { name: 'Review your proposal' }).waitFor();

      const bodyText = await page.locator('body').innerText();
      const html = await page.content();

      // --- content assertions per state ---
      if (key === 'a-accepted') {
        if (!bodyText.includes('Automated explanation')) failures.push(`${key}@${widthLabel}: missing "Automated explanation" label`);
        if (!bodyText.includes('your energy target is')) failures.push(`${key}@${widthLabel}: missing accepted prose text`);
        const tokens = await page.evaluate(() => window.__fixtureNumericTokens);
        // number-formatter parity: the digit token quoted in the prose must equal the digit
        // token rendered on the plan card (both derive from formatNumericDisplayValue).
        const cardEnergyText = await page.locator('dt', { hasText: 'Energy' }).locator('xpath=following-sibling::dd[1]').innerText();
        if (!cardEnergyText.includes(tokens.energyToken)) failures.push(`${key}@${widthLabel}: plan card energy "${cardEnergyText}" does not contain formatter token "${tokens.energyToken}"`);
        if (!bodyText.includes(tokens.energyToken + ' kcal per day')) failures.push(`${key}@${widthLabel}: prose does not quote the exact formatter token "${tokens.energyToken}"`);
      }
      if (key === 'b-rejected-template') {
        if (!bodyText.includes('Automated explanation')) failures.push(`${key}@${widthLabel}: missing "Automated explanation" label on template fallback`);
        if (!bodyText.includes('TEMPLATE FIXTURE: your synthetic proposal is ready for review.')) failures.push(`${key}@${widthLabel}: template sentence not rendered`);
        if (/<p class="mt-1 text-zinc-100"><\/p>/.test(html)) failures.push(`${key}@${widthLabel}: empty paragraph present (degrade-never-disappear violation)`);
      }
      if (key === 'c-no-run') {
        if (bodyText.includes('Automated explanation')) failures.push(`${key}@${widthLabel}: "Automated explanation" block rendered with no run decision`);
        if (/<p class="mt-1 text-zinc-100"><\/p>/.test(html)) failures.push(`${key}@${widthLabel}: empty paragraph present with no run decision`);
      }
      if (key === 'd-clarification-absent') {
        if (!bodyText.includes('A specific answer is still required. Your current plan remains unchanged.')) failures.push(`${key}@${widthLabel}: clarification template sentence not rendered`);
        // no visible blank content block in place of the sentence
        const blankParas = await page.locator('p').filter({ hasText: /^\\s*$/ }).count();
        if (blankParas > 0) failures.push(`${key}@${widthLabel}: ${blankParas} blank paragraph(s) present`);
      }
      if (key === 'e-ceiling-400') {
        const ceilingLength = await page.evaluate(() => window.__ceilingLength);
        if (ceilingLength < 380 || ceilingLength > 400) failures.push(`${key}@${widthLabel}: fixture ceiling text length ${ceilingLength} not near the 400-char ceiling`);
        // confirm the full text node is present untruncated in the DOM, and that the
        // paragraph's OWN class list (not the whole page, which embeds Tailwind's full compiled
        // utility sheet and would always contain the substring "truncate") carries no
        // truncation/clamp class.
        const explanationP = page.locator('p.mt-1.text-zinc-100');
        const rendered = await explanationP.innerText();
        const ownClass = await explanationP.getAttribute('class');
        if (/\btruncate\b|\bline-clamp-/.test(ownClass ?? '')) failures.push(`${key}@${widthLabel}: truncation class "${ownClass}" present on ceiling-length prose`);
        if (rendered.length < 350) failures.push(`${key}@${widthLabel}: rendered prose shorter than expected (${rendered.length} chars) — possible clipping`);
      }

      // --- cross-state checks ---
      // No horizontal overflow at the mobile width.
      if (widthLabel === '390') {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (overflow) failures.push(`${key}@390: horizontal overflow (scrollWidth > innerWidth)`);
      }
      // 48px minimum tap target on the primary action buttons where they exist on this state.
      for (const label of ['Accept proposal', 'Decline', 'Run final safety checks']) {
        const btn = page.getByRole('button', { name: label, exact: true });
        if (await btn.count()) {
          const box = await btn.boundingBox();
          if (!box || box.height < 48) failures.push(`${key}@${widthLabel}: "${label}" button height ${box?.height} < 48px`);
        }
      }
      // Focus visibility on the first nav link (keyboard tab from a fresh page load).
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const style = getComputedStyle(el);
        return { tag: el.tagName, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
      });
      if (!outline || outline.outlineStyle === 'none' || outline.outlineWidth === '0px') {
        // Root cause verified directly against the real Next.js-built CSS
        // (.next/static/chunks): app/globals.css's `[class*="focus-visible:outline"]:focus-visible
        // { outline: none; }` rule is UNLAYERED plain CSS (brace-depth 0, no surrounding @layer),
        // while Tailwind's own `.focus-visible\:outline-2`/`.focus-visible\:outline-blue-400`
        // utilities live inside Tailwind's `@layer utilities`. Per the CSS cascade-layers spec,
        // unlayered rules always beat layered rules regardless of selector specificity or source
        // order, so this override always wins and nulls the outline to `none` for every control
        // using Tailwind's focus-visible:outline-* utility — which is every button/link on this
        // screen (`button`/`primary` consts, experience.tsx:7-9). This predates T-2030 (globals.css
        // and those consts are untouched by the diff); recorded as a design-system finding, not a
        // T-2030 regression.
        findings.push(`${key}@${widthLabel}: no visible focus outline on first tab stop (${JSON.stringify(outline)}) — pre-existing app/globals.css cascade-layer bug, not in T-2030's diff`);
      }

      await page.screenshot({ path: `${OUT_DIR}/${key}-${widthLabel}.png`, fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (findings.length) {
  console.log('FINDINGS (not blocking, out of T-2030 scope):\n' + findings.map(f => ` - ${f}`).join('\n'));
}
if (failures.length) {
  console.error('FAIL:\n' + failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
console.log('PASS: 5 states x 2 widths captured to ' + OUT_DIR);
console.log('states: a-accepted, b-rejected-template, c-no-run, d-clarification-absent, e-ceiling-400');
