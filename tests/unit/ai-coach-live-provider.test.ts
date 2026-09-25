import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import type { ActiveAiCoachLiveRelease } from "@/lib/ai-coach/live-launch/repository";
import {
  ApprovedConstrainedGatewayProvider,
  LiveProviderConfigurationError,
} from "@/lib/ai-coach/provider/live-gateway";
import type { ConstrainedProviderEnvelope } from "@/lib/ai-coach/provider/adapter";
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

const validTransportResponse = {
  output: {
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
  },
  usage: { inputTokens: 12, outputTokens: 9, spendMinorUnits: 1 },
};

describe("approved constrained provider transport", () => {
  it("sends only the strict minimized envelope and fixed privacy controls", async () => {
    const fetchImplementation = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(
        [
          "allowTrainingUse",
          "contract",
          "envelope",
          "modelIdentifier",
          "providerConfigurationDigest",
          "providerConfigurationId",
          "schemaVersion",
          "store",
        ].sort()
      );
      expect(body).not.toHaveProperty("clientId");
      expect(body).not.toHaveProperty("tenantId");
      expect(body).not.toHaveProperty("packetId");
      expect(body).not.toHaveProperty("artifactBindings");
      expect(body).toMatchObject({ store: false, allowTrainingUse: false });
      expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
      return new Response(JSON.stringify(validTransportResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = new ApprovedConstrainedGatewayProvider(
      release(),
      fetchImplementation as typeof fetch,
      () => "synthetic-secret-not-logged"
    );

    await expect(
      provider.invoke(envelope(), { signal: new AbortController().signal })
    ).resolves.toEqual(validTransportResponse);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("rejects a synthetic prompt contract, missing credential, private URL, and invalid response", async () => {
    const notCalled = vi.fn();
    const provider = new ApprovedConstrainedGatewayProvider(
      release(),
      notCalled as typeof fetch,
      () => "token"
    );
    await expect(
      provider.invoke(envelope("t1007-synthetic-v1"), {
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(LiveProviderConfigurationError);
    expect(notCalled).not.toHaveBeenCalled();

    const noCredential = new ApprovedConstrainedGatewayProvider(
      release(),
      notCalled as typeof fetch,
      () => undefined
    );
    await expect(
      noCredential.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toThrow("credential is unavailable");

    const privateRelease = release();
    privateRelease.runtimeConfiguration.provider.gatewayUrl = "https://127.0.0.1/provider";
    privateRelease.runtimeConfigurationDigest = contentHash(privateRelease.runtimeConfiguration);
    const privateProvider = new ApprovedConstrainedGatewayProvider(
      privateRelease,
      notCalled as typeof fetch,
      () => "token"
    );
    await expect(
      privateProvider.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toThrow("not a permitted public HTTPS endpoint");

    const invalidResponse = new ApprovedConstrainedGatewayProvider(
      release(),
      vi.fn(
        async () => new Response(JSON.stringify({ output: { invented: true } }))
      ) as typeof fetch,
      () => "token"
    );
    await expect(
      invalidResponse.invoke(envelope(), { signal: new AbortController().signal })
    ).rejects.toThrow();
  });
});
