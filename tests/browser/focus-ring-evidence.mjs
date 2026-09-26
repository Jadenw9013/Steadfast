// T-2012 focus-ring evidence. Renders the repo's shared control classes against the
// *built* CSS (`.next/static/chunks/*.css`) — the defect is a cascade-layer interaction
// that only exists after the Tailwind build, so the source stylesheet cannot show it.
// Drives real keyboard focus (Tab) in Chromium and reports the computed focus indicator.
//
// Run: pnpm run build  (once), then
//      pnpm exec node tests/browser/focus-ring-evidence.mjs before|after
import { createRequire } from "node:module";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const mode = process.argv[2] ?? "after";
const root = process.cwd();
const outDir = `/private/tmp/steadfast-evidence-qa/T-2012/${mode}`;
mkdirSync(outDir, { recursive: true });

const cssDir = path.join(root, ".next/static/chunks");
const css = readdirSync(cssDir)
  .filter((n) => n.endsWith(".css"))
  .map((n) => readFileSync(path.join(cssDir, n), "utf8"))
  .join("\n");

// Class strings copied verbatim from the shared constants / canonical patterns.
// Kept as literals so this harness does not import modules other tickets are editing.
const AI_BUTTON =
  "min-h-12 rounded-xl border border-white/15 px-4 py-3 text-zinc-100 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50";
const AI_PRIMARY = `${AI_BUTTON} min-h-14 border-blue-500 bg-blue-600 hover:bg-blue-500`;
const MASTER_SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 px-5 text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black";
const NAV_LINK =
  "inline-flex min-h-12 items-center rounded-lg px-3.5 py-1.5 text-sm font-semibold text-zinc-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

// `focus-visible:outline-none` with no ring — components/coach/training/block-card.tsx.
// Narrowing the T-2012 opt-out to `focus-visible:ring-*` means these now fall back
// to the global outline instead of having no indicator at all.
const BARE_OUTLINE_NONE =
  "min-w-0 flex-1 bg-transparent text-sm font-medium placeholder-zinc-400 focus-visible:outline-none";

const controls = [
  { id: "ai-primary", label: "AI Coach primary button (shared `primary` constant)" },
  { id: "ai-secondary", label: "AI Coach secondary button (shared `button` constant)" },
  { id: "master-secondary", label: "MASTER.md ring-pattern secondary button" },
  { id: "nav-link", label: "Nav bar link" },
  { id: "sf-primary", label: ".sf-button-primary" },
  { id: "text-input", label: ".sf-input text field" },
  { id: "select", label: ".sf-select" },
  { id: "bare-outline-none", label: "block-card inline input (focus-visible:outline-none, no ring)" },
];

const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>body{background:#09090b;padding:24px;display:flex;flex-direction:column;gap:20px;align-items:flex-start}</style>
</head><body>
<button id="ai-primary" class="${AI_PRIMARY}">Accept proposal</button>
<button id="ai-secondary" class="${AI_BUTTON}">Decline</button>
<a id="master-secondary" href="#" class="${MASTER_SECONDARY}">Secondary action</a>
<a id="nav-link" href="#" class="${NAV_LINK}">Dashboard</a>
<button id="sf-primary" class="sf-button-primary">Save</button>
<input id="text-input" class="sf-input" placeholder="Body weight" />
<select id="select" class="sf-select"><option>Option</option></select>
<input id="bare-outline-none" class="${BARE_OUTLINE_NONE}" placeholder="Block name" />
</body></html>`;

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const report = [];
try {
  for (const [wName, viewport] of [
    ["390", { width: 390, height: 844 }],
    ["1440", { width: 1440, height: 900 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.route("http://localhost:4177/**", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.goto("http://localhost:4177/focus");

    // Record each control's resting appearance so a focus indicator can be told
    // apart from a shadow/border the control already had.
    await page.evaluate((ids) => {
      for (const id of ids) {
        const el = document.getElementById(id);
        const s = getComputedStyle(el);
        el.dataset.restingBorder = s.borderColor;
        el.dataset.restingShadow = s.boxShadow;
      }
    }, controls.map((c) => c.id));

    for (const { id, label } of controls) {
      // Real keyboard focus: :focus-visible only matches keyboard-initiated focus.
      await page.evaluate(() => document.body.focus());
      await page.evaluate((target) => {
        const el = document.getElementById(target);
        const prev = document.createElement("button");
        prev.id = "__tabseed";
        prev.style.cssText = "position:fixed;top:-100px;left:0";
        el.parentNode.insertBefore(prev, el);
        prev.focus();
      }, id);
      await page.keyboard.press("Tab");

      // globals.css transitions box-shadow/border-color over 200ms on
      // button/a/input/select/textarea. Reading computed style immediately after
      // Tab samples the interpolation, not the settled focus state.
      await page.waitForTimeout(500);

      const styles = await page.evaluate((target) => {
        const el = document.getElementById(target);
        if (document.activeElement !== el) return { error: `Tab landed on ${document.activeElement?.id}` };
        const s = getComputedStyle(el);
        return {
          matchesFocusVisible: el.matches(":focus-visible"),
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          outlineColor: s.outlineColor,
          outlineOffset: s.outlineOffset,
          boxShadow: s.boxShadow,
          borderColor: s.borderColor,
          borderRadius: s.borderRadius,
          restingBorderColor: el.dataset.restingBorder,
          restingBoxShadow: el.dataset.restingShadow,
        };
      }, id);

      const hasOutline =
        styles.outlineStyle && styles.outlineStyle !== "none" && parseFloat(styles.outlineWidth) > 0;
      // A ring must actually paint: at least one box-shadow layer with a non-zero
      // spread/blur that is not the control's resting shadow.
      const hasRing =
        Boolean(styles.boxShadow) &&
        styles.boxShadow !== "none" &&
        styles.boxShadow !== styles.restingBoxShadow &&
        /\d+(\.\d+)?px/.test(styles.boxShadow) &&
        !/^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+$/.test(styles.boxShadow);
      const hasBorderChange =
        Boolean(styles.restingBorderColor) && styles.borderColor !== styles.restingBorderColor;
      report.push({
        width: wName,
        id,
        label,
        visibleRing: Boolean(hasOutline || hasRing),
        indicator: hasOutline ? "outline" : hasRing ? "ring" : hasBorderChange ? "border-only" : "none",
        ...styles,
      });

      await page.screenshot({ path: `${outDir}/${wName}-${id}.png`, fullPage: false });
      await page.evaluate(() => document.getElementById("__tabseed")?.remove());
    }

    // Constraint: a mouse click must not draw a ring where it did not before.
    // `:focus-visible` is what enforces that; verify it rather than assume it.
    for (const id of ["ai-primary", "ai-secondary", "master-secondary"]) {
      await page.click(`#${id}`);
      await page.waitForTimeout(500);
      const mouse = await page.evaluate((target) => {
        const el = document.getElementById(target);
        const s = getComputedStyle(el);
        return {
          focused: document.activeElement === el,
          focusVisible: el.matches(":focus-visible"),
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
        };
      }, id);
      report.push({ width: wName, id: `${id} (mouse click)`, label: "mouse click", mouse });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
for (const r of report.filter((x) => !x.mouse)) {
  console.log(
    `[${r.width}] ${(r.indicator ?? "none").padEnd(11)} ${r.id.padEnd(19)} outline=${r.outlineStyle}/${r.outlineWidth}/${r.outlineColor} offset=${r.outlineOffset} radius=${r.borderRadius}`,
  );
}
console.log("");
const mouseRings = [];
for (const r of report.filter((x) => x.mouse)) {
  const drew = r.mouse.outlineStyle !== "none" && parseFloat(r.mouse.outlineWidth) > 0;
  if (drew) mouseRings.push(`${r.width}:${r.id}`);
  console.log(
    `[${r.width}] mouse-click ${r.id.padEnd(30)} focus-visible=${r.mouse.focusVisible} outline=${r.mouse.outlineStyle}/${r.mouse.outlineWidth}`,
  );
}
console.log("");
const missing = report.filter((r) => !r.mouse && !r.visibleRing);
const keyboard = report.filter((r) => !r.mouse);
console.log(
  `${mode}: ${keyboard.length - missing.length}/${keyboard.length} controls show an outline or ring on keyboard focus`,
);
if (missing.length) {
  console.log("outline/ring absent:", missing.map((m) => `${m.width}:${m.id} (${m.indicator})`).join(", "));
}
if (mouseRings.length) {
  console.log("REGRESSION — ring drawn on mouse click:", mouseRings.join(", "));
}
console.log(`screenshots: ${outDir}`);
process.exit(mouseRings.length ? 1 : 0);
