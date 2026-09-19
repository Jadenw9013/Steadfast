import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { AiCoachError } from "@/lib/ai-coach/access";
import {
  REDACTED,
  redactContext,
  routePattern,
  safeFrames,
  sanitizeErrorMessage,
} from "@/lib/observability/redact";

/**
 * T-920 — the redaction contract is the whole ticket. Every case here proves
 * something that SHOULD be redacted actually is, not just that the happy path
 * passes through.
 */

describe("redactContext — scrub patterns (context values)", () => {
  const cases: Array<[string, string]> = [
    ["email", "reach me at alice@example.com please"],
    ["E.164 phone", "call +14155552671 now"],
    ["JWT", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123 was sent"],
    ["sk_ key", "key sk_live_ABC123xyz789 leaked"],
    ["pk_ key", "key pk_test_ABC123xyz789 leaked"],
    ["whsec_ key", "secret whsec_ABC123xyz789 leaked"],
    ["URL with query string", "see https://example.com/path?token=abc&x=1 for details"],
    ["200-char base64 run", "blob " + "A".repeat(200) + " end"],
  ];

  for (const [label, raw] of cases) {
    it(`redacts a ${label} in a context value`, () => {
      const result = redactContext({ note: raw }, ["note"]);
      expect(result).toBeDefined();
      const value = String(result?.note);
      expect(value).toContain(REDACTED);
      // The specific offending substring must not survive scrubbing.
      if (label === "email") expect(value).not.toContain("alice@example.com");
      if (label === "E.164 phone") expect(value).not.toContain("+14155552671");
      if (label === "JWT") expect(value).not.toContain("eyJzdWIiOiIxMjM0NTY3ODkwIn0");
      if (label === "sk_ key") expect(value).not.toContain("sk_live_ABC123xyz789");
      if (label === "pk_ key") expect(value).not.toContain("pk_test_ABC123xyz789");
      if (label === "whsec_ key") expect(value).not.toContain("whsec_ABC123xyz789");
      if (label === "URL with query string") expect(value).not.toContain("token=abc");
      if (label === "200-char base64 run") expect(value).not.toContain("A".repeat(200));
    });

    it(`redacts a ${label} inside an error message via sanitizeErrorMessage`, () => {
      const error = new AiCoachError("SOME_CODE", raw);
      const message = sanitizeErrorMessage(error);
      expect(message).toBeDefined();
      expect(message).toContain(REDACTED);
      if (label === "email") expect(message).not.toContain("alice@example.com");
      if (label === "E.164 phone") expect(message).not.toContain("+14155552671");
      if (label === "JWT") expect(message).not.toContain("eyJzdWIiOiIxMjM0NTY3ODkwIn0");
      if (label === "sk_ key") expect(message).not.toContain("sk_live_ABC123xyz789");
      if (label === "pk_ key") expect(message).not.toContain("pk_test_ABC123xyz789");
      if (label === "whsec_ key") expect(message).not.toContain("whsec_ABC123xyz789");
      if (label === "URL with query string") expect(message).not.toContain("token=abc");
      if (label === "200-char base64 run") expect(message).not.toContain("A".repeat(200));
    });
  }
});

describe("redactContext — key-prefix scrub is anchored, not substring", () => {
  const ordinaryWords: Array<[string, string]> = [
    ["task_status", "the task_status field is READY"],
    ["risk_level", "risk_level is MODERATE for this client"],
    ["disk_usage", "disk_usage at 40%"],
  ];

  for (const [word, raw] of ordinaryWords) {
    it(`does not mangle "${word}", which merely contains an sk_/pk_/whsec_-like substring`, () => {
      const result = redactContext({ note: raw }, ["note"]);
      expect(result?.note).toBe(raw);
      expect(String(result?.note)).not.toContain(REDACTED);
    });
  }

  it("still redacts a real key immediately after an ordinary word", () => {
    const result = redactContext({ note: "task_status ok, key sk_live_ABC123xyz789 leaked" }, ["note"]);
    expect(String(result?.note)).toContain(REDACTED);
    expect(String(result?.note)).not.toContain("sk_live_ABC123xyz789");
    expect(String(result?.note)).toContain("task_status");
  });
});

describe("redactContext — allow-list", () => {
  it("drops a key absent from allow", () => {
    const result = redactContext({ secretPlan: "confidential", weeksWithPrograms: 2 }, ["weeksWithPrograms"]);
    expect(result).toEqual({ weeksWithPrograms: 2 });
    expect(result).not.toHaveProperty("secretPlan");
  });

  it("keeps a key present in allow", () => {
    const result = redactContext({ planMode: "MACROS" }, ["planMode", "itemCount"]);
    expect(result).toEqual({ planMode: "MACROS" });
  });

  it("returns undefined when context is undefined", () => {
    expect(redactContext(undefined, ["planMode"])).toBeUndefined();
  });

  it("drops a non-primitive value even when its key is allowed", () => {
    const result = redactContext({ nested: { a: 1 } }, ["nested"]);
    expect(result).toBeUndefined();
  });
});

describe("redactContext — truncation", () => {
  it("truncates a context string value at 120 chars", () => {
    // Spaced words (not a contiguous base64-looking run) so only truncation,
    // not the base64 scrub pattern, is under test.
    const long = "hello world ".repeat(30);
    const result = redactContext({ note: long }, ["note"]);
    expect(result?.note).toHaveLength(120);
  });
});

describe("sanitizeErrorMessage — truncation and allow-list", () => {
  it("truncates an error message at 200 chars", () => {
    // Spaced words (not a contiguous base64-looking run) so only truncation,
    // not the base64 scrub pattern, is under test.
    const long = "hello world ".repeat(50);
    const error = new AiCoachError("SOME_CODE", long);
    const message = sanitizeErrorMessage(error);
    expect(message).toHaveLength(200);
  });

  it("returns undefined for a plain Error, an unlisted class — errorName is a separate concern", () => {
    const error = new Error("client said: alice@example.com");
    expect(sanitizeErrorMessage(error)).toBeUndefined();
    // errorName is built by the caller from the constructor, not from this
    // function, and must still be available even though the message is not.
    expect(error.constructor.name).toBe("Error");
  });

  it("returns a scrubbed message for a ZodError", () => {
    const result = z.object({ email: z.string().email() }).safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
    const zodError = (result as { success: false; error: ZodError }).error;
    const message = sanitizeErrorMessage(zodError);
    expect(message).toBeDefined();
  });

  it("returns a scrubbed message for a PrismaClientKnownRequestError", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on alice@example.com", {
      code: "P2002",
      clientVersion: "7.5.0",
    });
    const message = sanitizeErrorMessage(error);
    expect(message).toBeDefined();
    expect(message).toContain(REDACTED);
    expect(message).not.toContain("alice@example.com");
  });
});

describe("routePattern", () => {
  it("strips the query string and replaces the id segment", () => {
    expect(routePattern("/api/coach/clients/clx123abc/meal-plan?weekOf=2026-09-14")).toBe(
      "/api/coach/clients/[id]/meal-plan"
    );
  });

  it("leaves a route with no id segments unchanged", () => {
    expect(routePattern("/api/coach/clients")).toBe("/api/coach/clients");
  });
});

describe("safeFrames", () => {
  it("drops every node_modules frame and emits file:line with no source text", () => {
    const stack = [
      "Error: boom",
      "    at getTrainingProgramForReview (/Users/dev/Steadfast/lib/queries/training-programs.ts:41:9)",
      "    at process (/Users/dev/Steadfast/node_modules/some-pkg/index.js:10:3)",
      "    at handler (/Users/dev/Steadfast/app/api/coach/clients/[clientId]/training/route.ts:22:5)",
    ].join("\n");

    const frames = safeFrames(stack);

    expect(frames).toEqual([
      "lib/queries/training-programs.ts:41",
      "app/api/coach/clients/[clientId]/training/route.ts:22",
    ]);
    expect(frames?.join(" ")).not.toContain("node_modules");
    // No function names, no source text — only "file:line".
    expect(frames?.every((f) => /^[a-z0-9._/[\]-]+:\d+$/i.test(f))).toBe(true);
  });

  it("returns undefined when the stack is undefined", () => {
    expect(safeFrames(undefined)).toBeUndefined();
  });
});
