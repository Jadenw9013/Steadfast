import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Reporter: concise in CI, verbose during watch
    reporters: process.env.CI ? ["default"] : ["verbose"],
    // Fail fast in CI, continue in watch
    bail: process.env.CI ? 1 : undefined,
    // Coverage configuration (activate with --coverage flag)
    coverage: {
      provider: "v8",
      include: [
        "lib/**/*.ts",
      ],
      exclude: [
        "lib/supabase/**",       // external service
        "lib/hooks/**",          // React hooks
        "lib/email/**",          // Resend integration
        "lib/sms/**",            // Twilio integration
        "lib/ocr/**",            // external API
        "lib/llm/**",            // external API
        "lib/notifications/**",  // external service
      ],
      reportsDirectory: "./coverage",
      reporter: ["text", "text-summary"],
      thresholds: {
        // Baseline — raise these as coverage improves
        statements: 30,
        branches: 25,
        functions: 30,
        lines: 30,
      },
    },
  },
});
