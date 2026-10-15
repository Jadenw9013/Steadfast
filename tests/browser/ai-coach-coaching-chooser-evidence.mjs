// S-34 UI evidence harness. Mounts the real AiCoachingChooser component
// against the real compiled Tailwind CSS (app/globals.css), no production
// auth bypass, DB or external network. Modelled on
// tests/browser/ai-coach-intake-wizard-evidence.mjs (esbuild -> Chromium ->
// real compiled CSS) and tests/browser/ai-coach-explanation-prose-evidence.mjs
// (the stub-next-link esbuild plugin — next/link pulls the App Router
// runtime and throws `process is not defined` in a plain browser bundle).
//
// Run:
//   node tests/browser/ai-coach-coaching-chooser-evidence.mjs
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
const OUT_DIR = "/Users/jadenwong/Dev/steadfast/hq/board/evidence/ui/S-34";
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

const BASE_OFFER = {
  releaseId: "release-1",
  configurationId: "config-1",
  configurationVersion: 1,
  locale: "en-US",
  serviceLabel: "Steadfast AI Coach",
  headline: "Personalized coaching, built around your routine",
  summary: "A short orienting summary of the AI coaching service, in plain language.",
  informationHeading: "How AI coaching works",
  disclosureParagraphs: [
    "Steadfast AI Coach creates personalized training and nutrition targets based on your preferences.",
  ],
  consentLabel: "I consent",
  confirmLabel: "Confirm",
  privacyNoticeLabel: "Privacy and Terms",
  continueLabel: "Start AI Coach",
  humanCoachLabel: "Find a human coach",
  eligibilitySummary: "Open to eligible accounts only.",
  privacyNoticeVersion: "v1",
  privacyNoticeUrl: "https://example.test/privacy",
  pricing: null,
};

const PRICING_OFFER = {
  ...BASE_OFFER,
  pricing: { productConfigurationId: "price-1", displayText: "$29/month, cancel anytime" },
};

const LONG_HEADLINE =
  "Personalized, adaptive coaching built around your schedule, your equipment, your goals, and your week-to-week progress over time";
assert.ok(LONG_HEADLINE.length >= 120, "fixture headline must be at least 120 characters");

const LONG_OFFER = {
  ...BASE_OFFER,
  headline: LONG_HEADLINE,
  summary:
    "A longer orienting summary describing the AI coaching service across more than one sentence, so the card has real height to test against at a narrow viewport.",
  disclosureParagraphs: [
    "Steadfast AI Coach creates personalized training and nutrition targets based on your preferences and your intake answers.",
    "This experience adapts week to week as you check in, without any clinical claim or outcome promise.",
    "You may switch to a human coach at any time; choosing this option does not lock in your account.",
  ],
};

const SCENARIOS = {
  "row4-enabled": { offer: BASE_OFFER, aiPreparationState: "ENABLED" },
  "row5-paused": { offer: BASE_OFFER, aiPreparationState: "PAUSED" },
  "row5-paused-with-pricing": { offer: PRICING_OFFER, aiPreparationState: "PAUSED" },
  "long-copy-no-clip": { offer: LONG_OFFER, aiPreparationState: "ENABLED" },
};

const css = await compileCss();
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AiCoachingChooser } from './components/ai-coach/coaching-chooser';

      const SCENARIOS = ${JSON.stringify(SCENARIOS)};

      window.__mountScenario = (key) => {
        const scenario = SCENARIOS[key];
        createRoot(document.getElementById('root')).render(
          React.createElement(AiCoachingChooser, scenario)
        );
      };
    `,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "stub-next-link",
      setup(b) {
        b.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "next-link-stub",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          resolveDir: root,
          contents: `
            import React from 'react';
            export default function Link({ href, children, ...rest }) {
              return React.createElement('a', { href, ...rest }, children);
            }
          `,
          loader: "jsx",
        }));
      },
    },
  ],
});

function htmlPage() {
  return `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#09090b;margin:0;padding:16px"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
}

async function registerRoutes(page) {
  await page.route("http://localhost:4177/**", async (route) => {
    return route.fulfill({ contentType: "text/html", body: htmlPage() });
  });
}

async function mountScenario(page, key) {
  await page.evaluate((scenario) => window.__mountScenario(scenario), key);
  await page.locator("h1#coaching-choice-heading").first().waitFor();
}

const LINK_HREFS = ["/client/ai-coach/start", "/coaches", "https://example.test/privacy"];

async function measureLinks(page, name, failures) {
  for (const href of LINK_HREFS) {
    const link = page.locator(`a[href="${href}"]`);
    const box = await link.boundingBox();
    if (!box) {
      failures.push(`${name}: link ${href} not found`);
      continue;
    }
    if (box.height < 48) {
      failures.push(`${name}: link ${href} is ${box.height}px tall, below the 48px floor`);
    }
  }
}

async function assertCardStacking(page, name, viewportWidth, failures) {
  const cards = page.locator("article");
  const count = await cards.count();
  if (count !== 2) {
    failures.push(`${name}@${viewportWidth}: expected 2 cards, found ${count}`);
    return;
  }
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  if (!first || !second) {
    failures.push(`${name}@${viewportWidth}: could not measure both cards`);
    return;
  }
  const stacked = second.y >= first.y + first.height - 1;
  const sideBySide = Math.abs(first.y - second.y) < 4 && second.x > first.x;
  if (viewportWidth === 400 && !stacked) {
    failures.push(`${name}@400: cards are not stacked (side by side at a 400px viewport)`);
  }
  if (viewportWidth === 1280 && !sideBySide) {
    failures.push(`${name}@1280: cards are not side by side on desktop`);
  }
}

async function assertNoHorizontalOverflow(page, name, failures) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  if (overflows) failures.push(`${name}@400: horizontal overflow (copy clipping risk)`);
}

const failures = [];
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
try {
  const page = await browser.newPage();
  await registerRoutes(page);

  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    for (const [label, viewport] of [
      ["1280", { width: 1280, height: 1000 }],
      ["400", { width: 400, height: 1200 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("http://localhost:4177/");
      await mountScenario(page, key);
      await measureLinks(page, key, failures);
      await assertCardStacking(page, key, viewport.width, failures);
      if (viewport.width === 400) await assertNoHorizontalOverflow(page, key, failures);

      // PAUSED/ENABLED notice presence check, pinned per-scenario.
      const noticeCount = await page.getByRole("status").count();
      const expectNotice = scenario.aiPreparationState !== "ENABLED";
      if (expectNotice && noticeCount !== 1) {
        failures.push(`${key}@${label}: expected exactly one role=status notice, found ${noticeCount}`);
      }
      if (!expectNotice && noticeCount !== 0) {
        failures.push(`${key}@${label}: unexpected role=status notice on an ENABLED render`);
      }

      await page.screenshot({ path: `${OUT_DIR}/${key}-${label}.png`, fullPage: true });
    }
  }
  console.log(`PASS: ${Object.keys(SCENARIOS).length} scenarios captured at 1280px and 400px`);
  await page.close();

  // 5. Keyboard focus ring on each of the three links.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await registerRoutes(page);
    await page.goto("http://localhost:4177/");
    await mountScenario(page, "row4-enabled");

    for (const href of LINK_HREFS) {
      const link = page.locator(`a[href="${href}"]`);
      await link.focus();
      await page.waitForTimeout(100);
      const focused = await link.evaluate((el) => document.activeElement === el);
      if (!focused) failures.push(`focus-ring: link ${href} did not receive focus`);
      const matchesFocusVisible = await link.evaluate((el) => el.matches(":focus-visible"));
      const styles = await link.evaluate((el) => {
        const s = getComputedStyle(el);
        return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
      });
      const hasOutline =
        styles.outlineStyle !== "none" && parseFloat(styles.outlineWidth) > 0;
      const hasRing = Boolean(styles.boxShadow) && styles.boxShadow !== "none";
      if (!matchesFocusVisible || (!hasOutline && !hasRing)) {
        failures.push(
          `focus-ring: link ${href} shows no visible keyboard focus indicator (outline=${styles.outlineStyle}/${styles.outlineWidth}, boxShadow=${styles.boxShadow})`
        );
      }
      const safeName = href.replace(/[^a-z0-9]+/gi, "-");
      await page.screenshot({ path: `${OUT_DIR}/focus-${safeName}.png`, fullPage: false });
    }
    console.log("PASS: keyboard focus ring captured for all three links");
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`FAIL:\n${failures.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`PASS: S-34 coaching-chooser evidence captured to ${OUT_DIR}`);
