import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // S-28: `loadReviewedArtifactSet` / `withReviewedArtifactSetForCurrentClient`
  // (lib/ai-coach/artifacts/repository.ts) resolve identity from the ambient
  // Clerk session via getCurrentDbUser(). Executor-context code (the cron
  // sweep, managed-executor.ts) has no request and no session, and must
  // resolve a run's artifacts from its own server-derived clientId instead
  // (resolveArtifactSetForClient / loadRunBoundArtifactSet). This was a
  // comment-only contract before S-28 and nothing stopped a new
  // executor-context caller from reaching the session-based loader again.
  // Only the files below are "current client" request-scoped call sites that
  // may import them; everything else under lib/ai-coach is denied so a future
  // mistake is a lint failure, not a silent identity bug.
  {
    files: ["lib/ai-coach/**/*.{ts,tsx}"],
    ignores: [
      "lib/ai-coach/artifacts/repository.ts",
      "lib/ai-coach/finalization.ts",
      "lib/ai-coach/nutrition-safety.ts",
      "lib/ai-coach/autonomy/gate.ts",
      "lib/ai-coach/provider/constrained-boundary.ts",
      "lib/ai-coach/provider/live-boundary.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/artifacts/repository"],
              importNames: ["loadReviewedArtifactSet", "withReviewedArtifactSetForCurrentClient"],
              message:
                "S-28: this loader resolves identity from the ambient Clerk session (getCurrentDbUser()), not from a server-derived clientId. Executor-context code must use resolveArtifactSetForClient(tx, clientId, request) or loadRunBoundArtifactSet instead. If this really is a request-scoped 'current client' caller, add the file to the ignores list in eslint.config.mjs next to the others.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
