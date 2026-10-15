/**
 * T-2012 regression guard: the keyboard focus ring must survive the CSS build.
 *
 * The defect this guards against is a cascade-*layer* interaction that does not
 * exist in the source stylesheet. `app/globals.css` is unlayered, Tailwind's
 * utilities live in `@layer utilities`, and an unlayered declaration beats a
 * layered one regardless of specificity or source order. So an unlayered
 * `[class*="focus-visible:outline"]:focus-visible { outline: none }` silently
 * deleted the ring from every control using `focus-visible:outline-*`, including
 * the shared `button` / `primary` constants in `components/ai-coach/controls.ts`.
 *
 * Reading the source cannot catch that, so this test runs the real Tailwind
 * compiler (`tailwindcss`'s public `compile()` — the same engine the Next build
 * uses through `@tailwindcss/postcss`) over `app/globals.css` and asserts against
 * the compiled, layered output.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";

const repoRoot = path.resolve(__dirname, "../..");
const require = createRequire(path.join(repoRoot, "noop.js"));

/** Class candidates the compiler must emit utilities for. */
const CANDIDATES = [
  "focus-visible:outline-2",
  "focus-visible:outline-blue-400",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-blue-500",
  "focus-visible:ring-offset-2",
  "rounded-xl",
];

async function buildGlobalsCss(): Promise<string> {
  const compiler = await compile(fs.readFileSync(path.join(repoRoot, "app/globals.css"), "utf8"), {
    base: repoRoot,
    async loadStylesheet(id: string, basedir: string) {
      let file: string;
      if (id.startsWith(".")) {
        file = path.resolve(basedir, id);
      } else {
        const pkgRoot = path.dirname(require.resolve("tailwindcss/package.json"));
        file = path.join(pkgRoot, id === "tailwindcss" ? "index.css" : id.replace(/^tailwindcss\//, ""));
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file += ".css";
      return { path: file, base: path.dirname(file), content: fs.readFileSync(file, "utf8") };
    },
  });
  return compiler.build(CANDIDATES);
}

type Rule = { selector: string; body: string; layers: string[] };

/**
 * Flattens compiled CSS into style rules annotated with their cascade-layer
 * context. Only `@layer` matters for this test; other at-rules (`@media`,
 * `@supports`) are transparent to layer precedence.
 */
function rulesWithLayerContext(css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: string[] = [];
  let i = 0;
  let preludeStart = 0;

  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      const prelude = css.slice(preludeStart, i).trim();
      if (prelude.startsWith("@")) {
        stack.push(prelude);
        i++;
        preludeStart = i;
        continue;
      }
      // Style rule: capture its declaration block verbatim.
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      rules.push({
        selector: prelude,
        body: css.slice(i + 1, j - 1),
        layers: stack.filter((s) => s.startsWith("@layer")).map((s) => s.replace(/^@layer\s+/, "")),
      });
      i = j;
      preludeStart = i;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      i++;
      preludeStart = i;
      continue;
    }
    if (ch === ";") {
      i++;
      preludeStart = i;
      continue;
    }
    i++;
  }
  return rules;
}

const removesOutline = (body: string) =>
  /(^|[;{\s])outline\s*:\s*(none|0)\b/i.test(body) ||
  /(^|[;{\s])outline-style\s*:\s*none\b/i.test(body) ||
  /(^|[;{\s])outline-width\s*:\s*0(px)?\b/i.test(body);

describe("app/globals.css keyboard focus ring (T-2012)", () => {
  it("has no unlayered rule that blanks the outline on focus-visible:outline-* controls", async () => {
    const rules = rulesWithLayerContext(await buildGlobalsCss());

    const offenders = rules.filter(
      (r) =>
        r.layers.length === 0 &&
        r.selector.includes("focus-visible") &&
        // Matches `[class*="focus-visible:outline"]` and `.focus-visible\:outline-none`
        // alike: any unlayered selector that keys off the outline utilities.
        /focus-visible\\?:outline/.test(r.selector) &&
        removesOutline(r.body),
    );

    expect(
      offenders.map((o) => `${o.selector} { ${o.body.trim()} }`),
      "an unlayered rule outranks Tailwind's layered focus-visible:outline-* utilities, " +
        "so this deletes the focus ring instead of replacing it (T-2012)",
    ).toEqual([]);
  });

  it("emits the focus-visible:outline-2 utility inside @layer utilities", async () => {
    const rules = rulesWithLayerContext(await buildGlobalsCss());
    const util = rules.find((r) => r.selector.includes("focus-visible\\:outline-2"));
    expect(util, "Tailwind must still emit the outline utility the shared constants use").toBeDefined();
    expect(util!.layers).toContain("utilities");
    expect(util!.body).toMatch(/outline-width:\s*2px/);
  });

  it("keeps a global fallback ring for controls that declare no focus treatment", async () => {
    const rules = rulesWithLayerContext(await buildGlobalsCss());
    const fallback = rules.find((r) => /(^|,)\s*\*?:focus-visible\s*$/.test(r.selector));
    expect(fallback, "globals.css must keep a `*:focus-visible` fallback outline").toBeDefined();
    expect(fallback!.body).toMatch(/outline:\s*2px solid/);
    // Forcing a radius here squares off rounded-xl controls and clips the ring.
    expect(fallback!.body).not.toMatch(/border-radius/);
  });

  it("still suppresses the fallback for focus-visible:ring-* controls, so they show one ring not two", async () => {
    const rules = rulesWithLayerContext(await buildGlobalsCss());
    const optOut = rules.find(
      (r) => r.layers.length === 0 && r.selector.includes('[class*="focus-visible:ring"]'),
    );
    expect(optOut, "the ring opt-out is what stops a double ring; it must stay").toBeDefined();
    expect(removesOutline(optOut!.body)).toBe(true);
  });

  it("never widens the focus ring to plain :focus (no ring on mouse click)", async () => {
    const rules = rulesWithLayerContext(await buildGlobalsCss());
    const blanketFocus = rules.filter((r) =>
      /(^|,)\s*\*?:focus(?![-\w(])\s*(,|$)/.test(r.selector) && /outline:\s*\d/.test(r.body),
    );
    expect(blanketFocus.map((r) => r.selector)).toEqual([]);
  });

  it("matches the built CSS when a Next build is present", async () => {
    const chunkDir = path.join(repoRoot, ".next/static/chunks");
    if (!fs.existsSync(chunkDir)) {
      // No build in this checkout; the compile-based assertions above cover the
      // same engine and layer model. Deliberately not a silent pass of a gate.
      console.log("[T-2012] .next/static/chunks absent — built-CSS cross-check not run");
      return;
    }
    const built = fs
      .readdirSync(chunkDir)
      .filter((n) => n.endsWith(".css"))
      .map((n) => fs.readFileSync(path.join(chunkDir, n), "utf8"))
      .join("\n");

    const offenders = rulesWithLayerContext(built).filter(
      (r) => r.layers.length === 0 && /focus-visible\\?:outline/.test(r.selector) && removesOutline(r.body),
    );
    expect(offenders.map((o) => o.selector)).toEqual([]);
  });
});
