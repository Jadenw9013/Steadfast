// T-502 ui-qa evidence harness. Real React component (ReviewerWorkspace) mounted against a
// synthetic HTTP boundary, exactly the pattern in tests/browser/ai-coach-evidence.mjs — this is
// a SIBLING harness, the existing file is untouched. No production auth bypass, no network I/O
// beyond a local Playwright-controlled page.
//
// Renders "Assigned operational health" (components/ai-coach/reviewer-workspace.tsx) with
// fixture `initial` props covering four notificationDelivery states: DISABLED_BY_FLAG, ENABLED
// (pending >= 1), PAUSED, and an unmapped value to prove the fallback sentence renders instead
// of a blank panel (release-safety §4).
//
// Run: DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" \
//   node tests/browser/ai-coach-ops-panel-evidence.mjs
// (DATABASE_URL is not read by this script — no DB, no Prisma, no server action is touched —
// but is set per the standing rule for any Playwright/dev-server invocation in this repo.)
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
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

const OUT_DIR = '/Users/jadenwong/Dev/steadfast-hq/board/evidence/ui/T-502';
mkdirSync(OUT_DIR, { recursive: true });

// ---------- Compile the real Tailwind config against the real component files ----------
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

// ---------- Fixture `initial` props (Awaited<ReturnType<typeof getReviewerQueue>>) ----------
// Field shapes taken from lib/ai-coach/reviewer.ts:19-24 and lib/ai-coach/reviewer-operations.ts:38.
function baseQueue(operations) {
  return {
    backlog: 0,
    capacity: 50,
    capacityReached: false,
    oldestPendingAt: null,
    candidates: [],
    operations,
  };
}
const SAMPLED_AT = '2026-09-25T16:00:00.000Z';
const states = {
  'state-1-disabled-by-flag': baseQueue({
    sampledAt: SAMPLED_AT,
    periodStartsAt: '2026-09-18T16:00:00.000Z',
    statuses: { FAILED: 1 },
    oldestOpenRunAt: '2026-09-24T10:00:00.000Z',
    expiredLeases: 0,
    retriedRuns: 2,
    pendingNotifications: 0,
    oldestNotificationAt: null,
    closedPendingProposals: 0,
    abandonedNotifications: 0,
    retiredNotifications: 0,
    notificationDelivery: 'DISABLED_BY_FLAG',
  }),
  'state-2-enabled-pending': baseQueue({
    sampledAt: SAMPLED_AT,
    periodStartsAt: '2026-09-18T16:00:00.000Z',
    statuses: { FAILED: 0 },
    oldestOpenRunAt: null,
    expiredLeases: 0,
    retriedRuns: 0,
    pendingNotifications: 1,
    oldestNotificationAt: '2026-09-24T22:15:00.000Z',
    closedPendingProposals: 0,
    abandonedNotifications: 0,
    retiredNotifications: 0,
    notificationDelivery: 'ENABLED',
  }),
  'state-3-paused': baseQueue({
    sampledAt: SAMPLED_AT,
    periodStartsAt: '2026-09-18T16:00:00.000Z',
    statuses: { FAILED: 0 },
    oldestOpenRunAt: null,
    expiredLeases: 0,
    retriedRuns: 0,
    pendingNotifications: 3,
    oldestNotificationAt: '2026-09-23T09:00:00.000Z',
    closedPendingProposals: 0,
    abandonedNotifications: 0,
    retiredNotifications: 0,
    notificationDelivery: 'PAUSED',
  }),
  // Not one of the three required captures. `notificationDelivery` is typed as
  // AcceptanceDeliveryState = "ENABLED"|"DISABLED_BY_FLAG"|"PAUSED"|"ERRORED" (lib/ai-coach/operations.ts),
  // and the panel's lookup object (reviewer-workspace.tsx) only has explicit English for the first
  // three; this proves the `?? "Notification delivery state is unavailable."` fallback renders
  // instead of the panel going blank (release-safety §4) for the fourth, ERRORED.
  'state-4-errored-fallback': baseQueue({
    sampledAt: SAMPLED_AT,
    periodStartsAt: '2026-09-18T16:00:00.000Z',
    statuses: { FAILED: 3 },
    oldestOpenRunAt: '2026-09-24T02:00:00.000Z',
    expiredLeases: 1,
    retriedRuns: 4,
    pendingNotifications: 2,
    oldestNotificationAt: '2026-09-24T02:00:00.000Z',
    closedPendingProposals: 1,
    abandonedNotifications: 1,
    retiredNotifications: 4,
    notificationDelivery: 'ERRORED',
  }),
};

const EXPECTED_SENTENCE = {
  'state-1-disabled-by-flag': 'Notification delivery is off; the outbox records intent only.',
  'state-2-enabled-pending': 'Notification delivery is active. Undelivered intents are retried on the hourly sweep.',
  'state-3-paused': 'Notification delivery is paused by an operational control; intents are held, not lost.',
  'state-4-errored-fallback': 'Notification delivery state is unavailable.',
};
const COUNTER_LABELS = [
  'Failed runs', 'Retried runs', 'Expired worker leases',
  'Undelivered notification intents', 'Abandoned notifications',
  'Retired notifications', 'Closed-window proposals',
];

const css = await compileCss();
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ReviewerWorkspace } from './components/ai-coach/reviewer-workspace';
      const states = ${JSON.stringify(states)};
      const key = location.pathname.replace('/', '');
      const initial = states[key];
      createRoot(document.getElementById('root')).render(<ReviewerWorkspace initial={initial} />);
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
});

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
let failures = [];
try {
  const context = await browser.newContext();
  await context.route('http://localhost:4176/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/api/ops/ai-coach/safety') {
      // SafetyReview (mounted unconditionally alongside the ops panel) fetches this on mount.
      return route.fulfill({ json: { data: [] } });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-black text-white" style="background: linear-gradient(to bottom, #070708, #020203, #09090B); margin:0;"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`,
    });
  });

  for (const [key, expectedSentence] of Object.entries(EXPECTED_SENTENCE)) {
    for (const [widthLabel, viewport] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      await page.goto(`http://localhost:4176/${key}`);
      const panel = page.locator('section[aria-label="Assigned operational health"]');
      await panel.waitFor();

      const panelText = await panel.innerText();
      // No counter renders `undefined`/`NaN` — the "degrade, never disappear" check.
      if (/undefined|NaN/.test(panelText)) failures.push(`${key}@${widthLabel}: panel text contains undefined/NaN`);
      if (!panelText.includes(expectedSentence)) failures.push(`${key}@${widthLabel}: missing expected sentence "${expectedSentence}"`);
      const dtCount = await panel.locator('dt').count();
      if (dtCount !== COUNTER_LABELS.length) failures.push(`${key}@${widthLabel}: expected ${COUNTER_LABELS.length} counters, found ${dtCount}`);
      for (const label of COUNTER_LABELS) {
        const has = await panel.locator('dt', { hasText: label }).count();
        if (!has) failures.push(`${key}@${widthLabel}: missing counter "${label}"`);
      }
      // 48px minimum tap target on the panel's own control.
      const refreshBtn = panel.locator('button', { hasText: 'Refresh operational state' });
      const box = await refreshBtn.boundingBox();
      if (!box || box.height < 48) failures.push(`${key}@${widthLabel}: Refresh button height ${box?.height} < 48px`);
      // No horizontal overflow at the mobile width.
      if (widthLabel === '390') {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (overflow) failures.push(`${key}@390: horizontal overflow (scrollWidth > innerWidth)`);
      }
      await page.screenshot({ path: `${OUT_DIR}/${key}-${widthLabel}.png`, fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('FAIL:\n' + failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`PASS: ${Object.keys(states).length} states x 2 widths captured to ${OUT_DIR}`);
console.log('states: ' + Object.keys(states).join(', '));
