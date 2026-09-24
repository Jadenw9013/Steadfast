import { z } from "zod";
import {
  constrainedProviderEnvelopeSchema,
  constrainedTransportResponseSchema,
  type ConstrainedModelProvider,
  type ConstrainedProviderEnvelope,
} from "./adapter";
import {
  assertActiveAiCoachLiveReleaseReady,
  type ActiveAiCoachLiveRelease,
} from "../live-launch/repository";
import { isApprovedProviderGatewayUrl } from "../live-launch/schema";
import { assertAiCoachOperationEnabled } from "../operations";
import { contentHash } from "../canonical-json";

const MAX_RESPONSE_BYTES = 65_536;

const gatewayRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    contract: z.literal("STEADFAST_CONSTRAINED_JSON_V1"),
    providerConfigurationId: z.string().min(1).max(180),
    providerConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    modelIdentifier: z.string().min(1).max(180),
    store: z.literal(false),
    allowTrainingUse: z.literal(false),
    envelope: constrainedProviderEnvelopeSchema,
  })
  .strict();

export class LiveProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveProviderConfigurationError";
  }
}

function approvedGatewayUrl(value: string) {
  const url = new URL(value);
  if (!isApprovedProviderGatewayUrl(value)) {
    throw new LiveProviderConfigurationError(
      "The approved provider gateway URL is not a permitted public HTTPS endpoint."
    );
  }
  return url;
}

/**
 * Final-provider transport for an approval-bound Steadfast gateway contract.
 * It sends only the minimized T-1007 envelope: never tenant identifiers,
 * artifact bodies, plan bodies, raw traces, tools, browsing or RAG access.
 */
export class ApprovedConstrainedGatewayProvider implements ConstrainedModelProvider {
  constructor(
    private readonly release: ActiveAiCoachLiveRelease,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly credential: () => string | undefined = () =>
      process.env.AI_COACH_PROVIDER_CREDENTIAL
  ) {}

  async invoke(input: ConstrainedProviderEnvelope, context: { signal: AbortSignal }) {
    const envelope = constrainedProviderEnvelopeSchema.parse(input);
    if (envelope.promptContractVersion !== "t1007-live-v1") {
      throw new LiveProviderConfigurationError(
        "A live provider may accept only the approved live prompt contract."
      );
    }
    const provider = this.release.runtimeConfiguration.provider;
    if (
      contentHash(this.release.runtimeConfiguration) !== this.release.runtimeConfigurationDigest
    ) {
      throw new LiveProviderConfigurationError("The runtime configuration digest changed.");
    }
    const token = this.credential()?.trim();
    if (!token) {
      throw new LiveProviderConfigurationError("The approved provider credential is unavailable.");
    }
    const body = gatewayRequestSchema.parse({
      schemaVersion: 1,
      contract: provider.protocol,
      providerConfigurationId: provider.configurationId,
      providerConfigurationDigest: this.release.runtimeConfigurationDigest,
      modelIdentifier: provider.modelIdentifier,
      store: false,
      allowTrainingUse: false,
      envelope,
    });
    const response = await this.fetchImplementation(approvedGatewayUrl(provider.gatewayUrl), {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: context.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "x-steadfast-contract": provider.protocol,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("The approved provider gateway returned an error.");
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("The approved provider gateway response was too large.");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("The approved provider gateway response was too large.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("The approved provider gateway response was not JSON.");
    }
    return constrainedTransportResponseSchema.parse(raw);
  }
}

/** Server-selected live provider; no caller chooses a packet, URL, model or policy. */
export async function loadApprovedConstrainedGatewayProvider() {
  await assertAiCoachOperationEnabled("PROVIDER");
  const release = await assertActiveAiCoachLiveReleaseReady();
  return {
    release,
    provider: new ApprovedConstrainedGatewayProvider(release),
    executionPolicy: {
      timeoutMs: release.runtimeConfiguration.provider.timeoutMs,
      maxAttempts: release.runtimeConfiguration.provider.maxAttempts,
      retryDelaysMs: release.runtimeConfiguration.provider.retryDelaysMs,
      maxInputTokens: release.runtimeConfiguration.provider.maxInputTokens,
      maxOutputTokens: release.runtimeConfiguration.provider.maxOutputTokens,
    },
  };
}
