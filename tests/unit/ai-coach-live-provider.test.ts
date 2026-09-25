import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import type { ActiveAiCoachLiveRelease } from "@/lib/ai-coach/live-launch/repository";
import {
  AnthropicConstrainedProvider,
  LiveProviderConfigurationError,
  anthropicClientOptions,
  buildConstrainedSystemPrompt,
  type AnthropicMessageResponse,
  type AnthropicParseRequest,
} from "@/lib/ai-coach/provider/anthropic-provider";
import {
  callConstrainedProvider,
  type ConstrainedProviderEnvelope,
} from "@/lib/ai-coach/provider/adapter";
import { estimateSpendMinorUnits } from "@/lib/ai-coach/provider/spend-limits";
import { TEST_RUNTIME_CONFIGURATION } from "@/tests/helpers/ai-live-launch";

function release(): ActiveAiCoachLiveRelease {
  const runtimeConfiguration = structuredClone(TEST_RUNTIME_CONFIGURATION);
  return {
    activationId: "synthetic-isolated-activation",
    packetId: "synthetic-isolated-packet",
    releaseId: "synthetic-isolated-release",
    packetDigest: "a".repeat(64),
    engineVersion: "ai-coach-artifact-engine-v1",
    jurisdictions: ["SYNTHETIC_TEST_JURISDICTION"],
    expiresAt: new Date(Date.now() + 60_000),
    runtimeConfigurationDigest: contentHash(runtimeConfiguration),
    runtimeConfiguration,
    artifactBindings: [],
  };
}

function envelope(
  promptContractVersion: ConstrainedProviderEnvelope["promptContractVersion"] = "t1007-live-v1"
): ConstrainedProviderEnvelope {
  return {
    schemaVersion: 1,
    operationId: randomUUID(),
    promptContractVersion,
    task: "INTERPRET_RANK_EXPLAIN",
    currentClientLanguage: [
      {
        id: "CURRENT_CLIENT_INPUT_1",
        text: "Prefers the approved synthetic option.",
        provenance: "CURRENT_CLIENT_VALIDATED",
      },
    ],
    allowed: {
      optionIds: ["OPTION_1"],
      preferenceIds: ["SYNTHETIC_PREFERENCE"],
      clarificationIds: ["SYNTHETIC_CLARIFICATION"],
      explanationTemplateIds: ["EXPLANATION_1"],
      reasonCodes: ["PREFERENCE_MATCH"],
      numericFieldIds: [],
      limitationIds: ["SYNTHETIC_LIMITATION"],
    },
    capabilities: {
      tools: [],
      browsing: false,
      rag: false,
      liveResearch: false,
      crossClientMemory: false,
    },
  };
}

const validOutput = {
  schemaVersion: 1,
  preferenceIds: ["SYNTHETIC_PREFERENCE"],
  concern: { disposition: "NONE", clarificationId: null },
  rankedOptionIds: ["OPTION_1"],
  explanation: {
    templateId: "EXPLANATION_1",
    reasonCodes: ["PREFERENCE_MATCH"],
    numericFieldIds: [],
    limitationIds: ["SYNTHETIC_LIMITATION"],
  },
};

const REAL_USAGE: AnthropicMessageResponse["usage"] = { input_tokens: 12, output_tokens: 9 };

// Kept in sync with MAX_PROVIDER_OUTPUT_BYTES (anthropic-provider.ts); redeclared
// here rather than imported so the byte-cap test constructs a payload that is
// provably larger than the cap without depending on the constant's exact value
// changing the test's own pass/fail boundary silently.
const MAX_PROVIDER_OUTPUT_BYTES_FOR_TEST = 70_000;

/**
 * T-996 review round 1, finding 2: this is the raw `messages.create` shape
 * (`content` blocks with a JSON string in the text block), never the SDK's
 * client-side-parsed `ParsedMessage`. The provider does its own JSON.parse;
 * nothing here relies on `messages.parse`'s throw-on-bad-JSON behaviour.
 */
function validTransportResponse(
  usage: AnthropicMessageResponse["usage"] = REAL_USAGE
): AnthropicMessageResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(validOutput) }],
    stop_reason: "end_turn",
    usage,
  };
}

describe("Anthropic constrained provider", () => {
  it("sends only the minimized envelope and no tenant identity", async () => {
    const transport = vi.fn(async (request: AnthropicParseRequest) => {
      expect(Object.keys(request).sort()).toEqual(
        ["max_tokens", "messages", "model", "output_config", "system"].sort()
      );
      expect("tools" in request).toBe(false);
      expect(request).not.toHaveProperty("temperature");
      expect(request).not.toHaveProperty("top_p");
      expect(request).not.toHaveProperty("top_k");
      expect(request).not.toHaveProperty("thinking");

      const payload = JSON.parse(request.messages[0].content) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(
        ["allowed", "capabilities", "currentClientLanguage", "task"].sort()
      );
      for (const entry of payload.currentClientLanguage as Record<string, unknown>[]) {
        expect(Object.keys(entry).sort()).toEqual(["id", "text"].sort());
      }

      const serialized = JSON.stringify(request);
      for (const forbidden of [
        "clientId",
        "tenantId",
        "packetId",
        "operationId",
        "artifactBindings",
        "payload",
        "targets",
        "policy",
      ]) {
        expect(serialized).not.toContain(`"${forbidden}"`);
      }
      return validTransportResponse();
    });
    const provider = new AnthropicConstrainedProvider(
      release(),
      transport,
      () => "synthetic-secret-not-logged"
    );

    await expect(
      provider.invoke(envelope(), { signal: new AbortController().signal })
    ).resolves.toMatchObject({ output: validOutput });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("system prompt carries the allowed IDs and the task contract, never client text", () => {
    const env = envelope();
    const system1 = buildConstrainedSystemPrompt(env);
    const system2 = buildConstrainedSystemPrompt(env);
    expect(system1).toBe(system2);
    for (const values of Object.values(env.allowed)) {
      for (const id of values) {
        expect(system1).toContain(id);
      }
    }
    for (const item of env.currentClientLanguage) {
      expect(system1).not.toContain(item.text);
    }
  });

  it("model, effort, max_tokens come from the packet", async () => {
    const rel = release();
    let captured: AnthropicParseRequest | null = null;
    const transport = vi.fn(async (request: AnthropicParseRequest) => {
      captured = request;
      return validTransportResponse();
    });
    const provider = new AnthropicConstrainedProvider(rel, transport, () => "token");
    await provider.invoke(envelope(), { signal: new AbortController().signal });
    expect(captured).not.toBeNull();
    expect(captured!.model).toBe(rel.runtimeConfiguration.provider.modelIdentifier);
    expect(captured!.output_config.effort).toBe(rel.runtimeConfiguration.provider.effort);
    expect(captured!.max_tokens).toBe(
      Math.min(rel.runtimeConfiguration.provider.maxOutputTokens, 16_000)
    );
  });

  it("client options pin egress, a timeout margin over the executor race, and zero SDK retries", () => {
    const rel = release();
    // T-996 review round 1, NIT: the SDK client timeout carries a small
    // margin over provider.timeoutMs so the executor's own race
    // (adapter.ts's invokeOnce) is unambiguously the single source of
    // PROVIDER_TIMEOUT classification.
    expect(anthropicClientOptions(rel, "token")).toEqual({
      apiKey: "token",
      authToken: null,
      baseURL: "https://api.anthropic.com",
      timeout: rel.runtimeConfiguration.provider.timeoutMs + 1_000,
      maxRetries: 0,
    });
  });

  it("maps usage and estimates spend", async () => {
    const rel = release();
    const transport = vi.fn(async () =>
      validTransportResponse({
        input_tokens: 1_000,
        cache_read_input_tokens: 500,
        output_tokens: 250,
      })
    );
    const provider = new AnthropicConstrainedProvider(rel, transport, () => "token");
    const result = await provider.invoke(envelope(), { signal: new AbortController().signal });
    const parsed = result as {
      usage: { inputTokens: number; outputTokens: number; spendMinorUnits: number };
    };
    expect(parsed.usage.inputTokens).toBe(1_500);
    expect(parsed.usage.outputTokens).toBe(250);
    const expectedSpend = estimateSpendMinorUnits(
      { inputTokens: 1_500, outputTokens: 250 },
      rel.runtimeConfiguration.provider.pricing
    );
    expect(parsed.usage.spendMinorUnits).toBe(expectedSpend);
    // Exact integer against the fixture's synthetic prices (300/1_500 per
    // million input/output tokens): ceil((1500*300 + 250*1500) / 1_000_000) = 1.
    expect(parsed.usage.spendMinorUnits).toBe(1);
  });

  it("refuses a synthetic prompt contract, a missing credential, a non-Anthropic vendor, and a wrong base URL", async () => {
    const notCalled = vi.fn();

    const syntheticContract = new AnthropicConstrainedProvider(release(), notCalled, () => "token");
    await expect(
      syntheticContract.invoke(envelope("t1007-synthetic-v1"), {
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(LiveProviderConfigurationError);
    expect(notCalled).not.toHaveBeenCalled();

    const noCredential = new AnthropicConstrainedProvider(release(), notCalled, () => undefined);
    await expect(
      noCredential.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toThrow("credential is unavailable");
    expect(notCalled).not.toHaveBeenCalled();

    const wrongVendor = release();
    (wrongVendor.runtimeConfiguration.provider as unknown as Record<string, unknown>).vendor =
      "OPENAI";
    wrongVendor.runtimeConfigurationDigest = contentHash(wrongVendor.runtimeConfiguration);
    const wrongVendorProvider = new AnthropicConstrainedProvider(
      wrongVendor,
      notCalled,
      () => "token"
    );
    await expect(
      wrongVendorProvider.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toThrow("not the approved Anthropic configuration");
    expect(notCalled).not.toHaveBeenCalled();

    const wrongBaseUrl = release();
    (wrongBaseUrl.runtimeConfiguration.provider as unknown as Record<string, unknown>).apiBaseUrl =
      "https://evil.invalid";
    wrongBaseUrl.runtimeConfigurationDigest = contentHash(wrongBaseUrl.runtimeConfiguration);
    const wrongBaseUrlProvider = new AnthropicConstrainedProvider(
      wrongBaseUrl,
      notCalled,
      () => "token"
    );
    await expect(
      wrongBaseUrlProvider.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toThrow("not the approved Anthropic configuration");
    expect(notCalled).not.toHaveBeenCalled();
  });

  it("fails closed without retrying, and with real usage recorded, on every non-usable completion shape", async () => {
    const overCapText = `{"padding":"${"x".repeat(MAX_PROVIDER_OUTPUT_BYTES_FOR_TEST)}"}`;
    const cases: Array<[string, AnthropicMessageResponse]> = [
      [
        "no text content block",
        { content: [{ type: "tool_use" }], stop_reason: "end_turn", usage: REAL_USAGE },
      ],
      [
        "refusal",
        {
          content: [{ type: "text", text: "I can't help with that." }],
          stop_reason: "refusal",
          usage: REAL_USAGE,
        },
      ],
      [
        "max_tokens truncation (partial JSON)",
        {
          content: [{ type: "text", text: '{"schemaVersion":1,"preferenceI' }],
          stop_reason: "max_tokens",
          usage: REAL_USAGE,
        },
      ],
      [
        "model_context_window_exceeded",
        {
          content: [{ type: "text", text: JSON.stringify(validOutput) }],
          stop_reason: "model_context_window_exceeded",
          usage: REAL_USAGE,
        },
      ],
      [
        "pause_turn",
        {
          content: [{ type: "text", text: JSON.stringify(validOutput) }],
          stop_reason: "pause_turn",
          usage: REAL_USAGE,
        },
      ],
      [
        "unparseable JSON on an end_turn completion",
        {
          content: [{ type: "text", text: "not valid json at all {{{" }],
          stop_reason: "end_turn",
          usage: REAL_USAGE,
        },
      ],
      [
        "raw text over the byte cap, checked before parsing",
        {
          content: [{ type: "text", text: overCapText }],
          stop_reason: "end_turn",
          usage: REAL_USAGE,
        },
      ],
    ];
    for (const [label, response] of cases) {
      const transport = vi.fn(async () => response);
      const provider = new AnthropicConstrainedProvider(release(), transport, () => "token");
      const result = await callConstrainedProvider(provider, envelope(), {
        timeoutMs: 1_000,
        maxAttempts: 2,
        retryDelaysMs: [0],
        maxInputTokens: 10_000,
        maxOutputTokens: 10_000,
      });
      expect(result, label).toMatchObject({
        ok: false,
        attempts: 1,
        failureCode: "PROVIDER_OUTPUT_INVALID",
      });
      expect(transport, label).toHaveBeenCalledOnce();
      // Spec step 8 / review finding 2: real usage is recorded even though
      // the output is rejected — the call still cost real tokens.
      expect(result.measurement.inputTokens, label).toBe(REAL_USAGE.input_tokens);
      expect(result.measurement.outputTokens, label).toBe(REAL_USAGE.output_tokens);
    }
  });

  it("redaction: never leaks the credential, client text or vendor message", async () => {
    const secretCredential = "sk-ant-super-secret-token-not-logged";
    const clientText = "a private synthetic client detail that must never leak.";
    const vendorMessage = `Vendor rejected request bearing ${secretCredential}: ${clientText}`;
    const transport = vi.fn(async () => {
      throw new Error(vendorMessage);
    });
    const env = envelope();
    env.currentClientLanguage[0].text = clientText;
    const provider = new AnthropicConstrainedProvider(release(), transport, () => secretCredential);

    let caught: unknown;
    try {
      await provider.invoke(env, { signal: new AbortController().signal });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain(secretCredential);
    expect(message).not.toContain(clientText);
    expect(message).not.toContain(vendorMessage);
    expect(String(caught)).not.toContain(secretCredential);
    expect(String(caught)).not.toContain(clientText);
    expect(JSON.stringify(caught)).not.toContain(secretCredential);
    expect(JSON.stringify(caught)).not.toContain(clientText);
  });

  it("retryable vs configuration errors", async () => {
    // Constructs genuine SDK error instances at runtime, purely to exercise
    // the frozen instanceof-based classification in mapAnthropicTransportError
    // (no string matching is allowed there). This is a dynamic import inside
    // the injected transport mock, executed only when the mock runs — no
    // network I/O occurs; nothing here is a static/top-level SDK import. Since
    // review finding 2, `create` throws only genuine transport/HTTP failures
    // here (parsing happens outside the transport, in the provider), so this
    // test's two throws are exactly the shapes production code can produce.
    const anthropicModule = await import("@anthropic-ai/sdk");

    const connectionFailureTransport = vi.fn(async () => {
      throw new anthropicModule.APIConnectionError({ message: "connection reset" });
    });
    const connectionProvider = new AnthropicConstrainedProvider(
      release(),
      connectionFailureTransport,
      () => "token"
    );
    const sleep = vi.fn(async () => {});
    const retryResult = await callConstrainedProvider(
      connectionProvider,
      envelope(),
      {
        timeoutMs: 1_000,
        maxAttempts: 2,
        retryDelaysMs: [0],
        maxInputTokens: 10_000,
        maxOutputTokens: 10_000,
      },
      { sleep }
    );
    expect(retryResult).toMatchObject({ ok: false, attempts: 2, failureCode: "PROVIDER_ERROR" });
    expect(connectionFailureTransport).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);

    const unauthorizedTransport = vi.fn(async () => {
      throw new anthropicModule.APIError(401, {}, "unauthorized", new Headers());
    });
    const unauthorizedProvider = new AnthropicConstrainedProvider(
      release(),
      unauthorizedTransport,
      () => "token"
    );
    await expect(
      unauthorizedProvider.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toBeInstanceOf(LiveProviderConfigurationError);
    expect(unauthorizedTransport).toHaveBeenCalledOnce();
  });

  it("no tools ever", async () => {
    const transport = vi.fn(async (request: AnthropicParseRequest) => {
      expect("tools" in request).toBe(false);
      const payload = JSON.parse(request.messages[0].content) as {
        capabilities: Record<string, unknown>;
      };
      expect(payload.capabilities).toEqual({
        tools: [],
        browsing: false,
        rag: false,
        liveResearch: false,
        crossClientMemory: false,
      });
      return validTransportResponse();
    });
    const provider = new AnthropicConstrainedProvider(release(), transport, () => "token");
    await provider.invoke(envelope(), { signal: new AbortController().signal });
    expect(transport).toHaveBeenCalledOnce();
  });
});
