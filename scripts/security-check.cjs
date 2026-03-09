#!/usr/bin/env node
/**
 * Security regression checks — standalone script.
 *
 * Run: node scripts/security-check.cjs
 *
 * Validates that security hardening invariants remain intact:
 * - Signed URL generation is centralized in media-access.ts
 * - Deprecated helpers are annotated
 * - Rate limit keys are properly separated
 * - Parse error responses are sanitized
 * - Storage helper has security annotation
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
let passed = 0;
let failed = 0;
const failures = [];

function src(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

function assert(name, condition) {
    if (condition) {
        console.log("  [PASS] " + name);
        passed++;
    } else {
        console.error("  [FAIL] " + name);
        failed++;
        failures.push(name);
    }
}

console.log("\nSecurity Regression Checks\n");

// 1. Signed URL centralization
console.log("> Signed URL centralization");
const checkIns = src("lib/queries/check-ins.ts");
assert("check-ins.ts does NOT import getSignedDownloadUrl", !checkIns.includes("getSignedDownloadUrl"));
assert("check-ins.ts does NOT call createSignedUrl", !checkIns.includes("createSignedUrl"));
assert("check-ins.ts has no url:await pattern", !/url:\s*await/.test(checkIns));

const storageAction = src("app/actions/storage.ts");
assert("storage action does NOT import getSignedDownloadUrl", !storageAction.includes("getSignedDownloadUrl"));

// 2. Legacy helpers removed
console.log("\n> Legacy helpers removed");
assert("getCheckInById is removed", !checkIns.includes("function getCheckInById"));
assert("getCheckInByClientAndWeek is removed", !checkIns.includes("function getCheckInByClientAndWeek"));
assert("getCheckInsByClientAndWeek is removed", !checkIns.includes("function getCheckInsByClientAndWeek"));

// 3. Rate limit key separation
console.log("\n> Rate limit key separation");
const rateLimit = src("lib/security/rate-limit.ts");
assert("rate-limit.ts has mealplan-parse key", rateLimit.includes('"mealplan-parse"'));
assert("rate-limit.ts has workout-parse key", rateLimit.includes('"workout-parse"'));
assert("rate-limit.ts does NOT have shared ocr-parse key", !rateLimit.includes('"ocr-parse"'));

const mealplanParse = src("app/api/mealplans/parse/route.ts");
assert("mealplan parse uses mealplan-parse key", mealplanParse.includes('"mealplan-parse"'));

const workoutParse = src("app/api/workout-import/parse/route.ts");
assert("workout parse uses workout-parse key", workoutParse.includes('"workout-parse"'));

// 4. Error sanitization
console.log("\n> Error response sanitization");
const parseRoutes = [
    "app/api/mealplans/parse/route.ts",
    "app/api/mealplans/parse-text/route.ts",
    "app/api/workout-import/parse/route.ts",
    "app/api/workout-import/parse-text/route.ts",
];
for (const route of parseRoutes) {
    const content = src(route);
    assert(route + " has generic error message", content.includes("Processing failed. Please try again"));
}

// 5. Storage security annotation
console.log("\n> Storage security annotation");
const storage = src("lib/supabase/storage.ts");
const storageIdx = storage.indexOf("export async function getSignedDownloadUrl");
const storagePre = storage.substring(Math.max(0, storageIdx - 400), storageIdx);
assert("getSignedDownloadUrl has SECURITY warning", storagePre.includes("SECURITY"));
assert("getSignedDownloadUrl references media-access.ts", storagePre.includes("media-access.ts"));

// Summary
console.log("\n" + "-".repeat(40));
console.log("Results: " + passed + " passed, " + failed + " failed");
if (failed > 0) {
    console.error("\nFailed checks: " + failures.join(", "));
    console.error("Security regression check FAILED\n");
    process.exit(1);
} else {
    console.log("\nAll security regression checks PASSED\n");
}
