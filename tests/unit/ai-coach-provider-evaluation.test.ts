import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callConstrainedProvider,
  constrainedProviderEnvelopeSchema,
  type ConstrainedModelProvider,
  type ConstrainedProviderEnvelope,
  type ConstrainedProviderOutput,
} from "@/lib/ai-coach/provider/adapter";
import { MAX_TOKENS_PER_STAGE_CALL } from "@/lib/ai-coach/provider/spend-limits";

const behaviorSchema = z.enum([
  "VALID",
  "ADD_AUTHORITY_FIELD",
  "ADD_TOOL_FIELD",
  "INVENT_OPTION_ID",
  "ADD_NUMERIC_FACT",
  "ADD_TENANT_FIELD",
  "INVENT_CLARIFICATION_ID",
  "CAUTION",
  "TRANSIENT_THEN_VALID",
  "INVALID_RESPONSE",
  "TOKEN_LIMIT",
  "TIMEOUT",
]);

const corpusSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusVersion: z.literal("t1009-synthetic-provider-evaluation-v1"),
    syntheticOnly: z.literal(true),
    description: z.string().min(1),
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            category: z.string().min(1),
            clientLanguage: z.string().min(1),
            behavior: behaviorSchema,
            expected: z.enum([
              "SUCCESS",
              "SUCCESS_AFTER_RETRY",
              "PROVIDER_OUTPUT_INVALID",
              "PROVIDER_RESPONSE_INVALID",
              "PROVIDER_TOKEN_LIMIT",
              "PROVIDER_TIMEOUT",
            ]),
          })
          .strict()
      )
      .min(10),
  })
  .strict();

const corpus = corpusSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../fixtures/ai-coach/provider-evaluation-v1.json", import.meta.url)),
      "utf8"
    )
  )
);

function envelopeFor(clientLanguage: string): ConstrainedProviderEnvelope {
  return constrainedProviderEnvelopeSchema.parse({
    schemaVersion: 1,
    operationId: "10090000-0000-4000-8000-000000000001",
    promptContractVersion: "t1007-synthetic-v1",
    task: "INTERPRET_RANK_EXPLAIN",
    currentClientLanguage: [
      {
        id: "synthetic-language",
        text: clientLanguage,
        provenance: "SYNTHETIC_SERVER_FIXTURE",
      },
    ],
    allowed: {
      optionIds: ["FOOD:synthetic-food-item"],
      preferenceIds: ["SYNTHETIC_PREFERENCE_SIMPLE"],
      clarificationIds: ["SYNTHETIC_CLARIFY_PREFERENCE"],
      explanationTemplateIds: ["synthetic-next-action"],
      reasonCodes: ["GATE_APPROVED"],
      numericFieldIds: ["SYNTHETIC_NUMERIC_FIELD"],
      limitationIds: ["SYNTHETIC_TEST_ONLY"],
    },
    capabilities: {
      tools: [],
      browsing: false,
      rag: false,
      liveResearch: false,
      crossClientMemory: false,
    },
  });
}

function validOutput(envelope: ConstrainedProviderEnvelope): ConstrainedProviderOutput {
  return {
    schemaVersion: 1,
    preferenceIds: envelope.allowed.preferenceIds,
    concern: { disposition: "NONE", clarificationId: null },
    rankedOptionIds: envelope.allowed.optionIds,
    explanation: {
      templateId: envelope.allowed.explanationTemplateIds[0],
      reasonCodes: envelope.allowed.reasonCodes,
      numericFieldIds: envelope.allowed.numericFieldIds,
      limitationIds: envelope.allowed.limitationIds,
    },
  };
}

function providerFor(
  behavior: z.infer<typeof behaviorSchema>,
  envelope: ConstrainedProviderEnvelope
): ConstrainedModelProvider {
  let calls = 0;
  return {
    async invoke(_input, { signal }) {
      calls += 1;
      const output = validOutput(envelope);
      if (behavior === "TRANSIENT_THEN_VALID" && calls === 1) {
        throw new Error("synthetic transient failure");
      }
      if (behavior === "TIMEOUT") {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("synthetic abort")));
        });
      }
      if (behavior === "INVALID_RESPONSE") return { invalid: true };
      if (behavior === "TOKEN_LIMIT") {
        return {
          output,
          usage: { inputTokens: MAX_TOKENS_PER_STAGE_CALL, outputTokens: 1 },
        };
      }
      if (behavior === "ADD_AUTHORITY_FIELD") {
        return {
          output: { ...output, activationRequested: true },
          usage: { inputTokens: 2, outputTokens: 3 },
        };
      }
      if (behavior === "ADD_TOOL_FIELD") {
        return {
          output: { ...output, tools: ["browser"] },
          usage: { inputTokens: 2, outputTokens: 3 },
        };
      }
      if (behavior === "INVENT_OPTION_ID") {
        return {
          output: { ...output, rankedOptionIds: ["FOOD:model-invented"] },
          usage: { inputTokens: 2, outputTokens: 3 },
        };
      }
      if (behavior === "ADD_NUMERIC_FACT") {
        return {
          output: { ...output, replacementValue: 999 },
          usage: { inputTokens: 2, outputTokens: 3 },
        };
      }
      if (behavior === "ADD_TENANT_FIELD") {
        return {
          output: { ...output, clientId: "another-client" },
          usage: { inputTokens: 2, outputTokens: 3 },
        };
      }
      if (behavior === "INVENT_CLARIFICATION_ID") {
        return {
          output: {
            ...output,
            concern: {
              disposition: "REQUEST_CLARIFICATION",
              clarificationId: "model-invented-question",
            },
          },
          usage: { inputTokens: 2, outputTokens: 3 },
        };
      }
      if (behavior === "CAUTION") {
        output.concern = { disposition: "INCREASE_CAUTION", clarificationId: null };
      }
      return { output, usage: { inputTokens: 2, outputTokens: 3 } };
    },
  };
}

describe("T-1009 versioned synthetic provider evaluation corpus", () => {
  it("has unique case IDs and covers required adversarial categories", () => {
    expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(corpus.cases.length);
    expect(corpus.cases.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "PROMPT_INJECTION",
        "TENANT_ISOLATION",
        "CATALOG_INTEGRITY",
        "FAIL_CLOSED",
        "RETRY",
        "TIMEOUT",
        "SPEND_LIMIT",
      ])
    );
  });

  for (const testCase of corpus.cases) {
    it(`${testCase.id}: ${testCase.expected}`, async () => {
      const envelope = envelopeFor(testCase.clientLanguage);
      let clock = 1_000;
      const attempts: unknown[] = [];
      const completed: unknown[] = [];
      const result = await callConstrainedProvider(
        providerFor(testCase.behavior, envelope),
        envelope,
        {
          timeoutMs: testCase.behavior === "TIMEOUT" ? 2 : 50,
          maxAttempts: testCase.behavior === "TIMEOUT" ? 2 : 3,
          retryDelaysMs: [7, 11],
        },
        {
          nowMs: () => {
            clock += 4;
            return clock;
          },
          sleep: async () => undefined,
          onAttempt: (measurement) => {
            attempts.push(measurement);
          },
          onComplete: (measurement) => {
            completed.push(measurement);
          },
        }
      );

      if (testCase.expected === "SUCCESS" || testCase.expected === "SUCCESS_AFTER_RETRY") {
        expect(result.ok).toBe(true);
      } else {
        expect(result).toMatchObject({ ok: false, failureCode: testCase.expected });
      }
      const expectedAttempts =
        testCase.expected === "SUCCESS_AFTER_RETRY" || testCase.expected === "PROVIDER_TIMEOUT"
          ? 2
          : 1;
      expect(result.attempts).toBe(expectedAttempts);
      expect(result.measurement).toMatchObject({
        schemaVersion: 1,
        attempts: expectedAttempts,
        operationId: envelope.operationId,
      });
      expect(result.measurement.attemptMeasurements).toHaveLength(expectedAttempts);
      expect(attempts).toHaveLength(expectedAttempts);
      expect(completed).toHaveLength(1);
      expect(result.measurement.totalTokens).toBe(
        result.measurement.inputTokens + result.measurement.outputTokens
      );
      expect(JSON.stringify(result.measurement)).not.toMatch(
        /clientLanguage|clientId|another-client|activate this plan|browser and retrieval/
      );
    });
  }

  it("measurement observer failures cannot change a validated safety result", async () => {
    const envelope = envelopeFor("Synthetic observer failure.");
    const result = await callConstrainedProvider(
      providerFor("VALID", envelope),
      envelope,
      { timeoutMs: 50, maxAttempts: 1, retryDelaysMs: [] },
      {
        onAttempt: () => {
          throw new Error("observer failure");
        },
        onComplete: () => {
          throw new Error("observer failure");
        },
      }
    );
    expect(result).toMatchObject({ ok: true, attempts: 1 });
  });
});
