import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * T-980 — repo-wide sibling of the CB01 guard in tests/unit/activation.test.ts.
 *
 * A phone-number *substring* (`phoneNumber: { contains: last10 }`) is never
 * proof of identity: any account whose stored number ends in the same digits
 * matches. CB01 removed it from lib/activation.ts and coaching-requests.ts;
 * T-980 removed the last copy from app/actions/intake.ts, where it emailed a
 * coach's intake packet to a stranger and wrote their address into the lead.
 * This static check fails if the pattern returns anywhere in product code.
 */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "lib", "components"];
const SKIP = new Set(["node_modules", "generated", ".next"]);

async function sourceFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...(await sourceFiles(p)));
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
}

const PATTERNS: RegExp[] = [
    /contains:[^\n]*phone/i,
    /phone[^\n]*slice\(-10\)/i,
];

describe("T-980 — no phone-substring identity match in product code", () => {
    it("no app/, lib/ or components/ file matches a phone number by substring", async () => {
        const hits: string[] = [];
        for (const d of SCAN_DIRS) {
            for (const file of await sourceFiles(join(ROOT, d))) {
                const lines = (await readFile(file, "utf8")).split("\n");
                lines.forEach((line, i) => {
                    if (PATTERNS.some((re) => re.test(line))) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
                });
            }
        }
        expect(hits).toEqual([]);
    });

    it("app/actions/intake.ts never queries User by phoneNumber", async () => {
        const source = await readFile(join(ROOT, "app/actions/intake.ts"), "utf8");
        expect(source).not.toMatch(/phoneNumber/);
    });
});
