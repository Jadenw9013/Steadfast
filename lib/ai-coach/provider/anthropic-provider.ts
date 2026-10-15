import {
  constrainedProviderEnvelopeSchema,
  constrainedProviderOutputObjectSchema,
  constrainedTransportResponseSchema,
  type ConstrainedModelProvider,
  type ConstrainedProviderEnvelope,
  type ConstrainedProviderExecutionPolicy,
} from "./adapter";
import { estimateSpendMinorUnits, MAX_NON_STREAMING_OUTPUT_TOKENS } from "./spend-limits";
import {
  assertActiveAiCoachLiveReleaseReady,
  type ActiveAiCoachLiveRelease,
} from "../live-launch/repository";
import { assertAiCoachOperationEnabled } from "../operations";
import { contentHash } from "../canonical-json";
import { PROSE_SYSTEM_RULES } from "./explanation-prose";

/**
 * T-996 — direct Anthropic Messages API provider for the T-1007 constrained
 * boundary. Replaces the invented `STEADFAST_CONSTRAINED_JSON_V1` gateway
 * contract (`live-gateway.ts`, deleted by this ticket): nothing in either
 * repo ever implemented that contract, so there was no live endpoint to
 * call. `@anthropic-ai/sdk` is loaded only through the dynamic `import()`
 * calls below — never a static import — so it never enters the synthetic
 * path or any client bundle. This file performs zero real inference by
 * itself; every call is gated by `assertAiCoachOperationEnabled("PROVIDER")`
 * and `assertActiveAiCoachLiveReleaseReady()`, and the flags that would let
 * either succeed in production stay OFF. The first real call is T-997.
 */

export const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
export const MAX_PROVIDER_OUTPUT_BYTES = 65_536; // moved verbatim from live-gateway.ts:16
// The Anthropic SDK's own request timeout is given a small margin over the
// executor's `PROVIDER_TIMEOUT_MS` race (adapter.ts's `invokeOnce`) so the
// executor's timer is unambiguously the single source of attempt accounting:
// if the SDK fired first, the attempt would classify PROVIDER_ERROR instead
// of PROVIDER_TIMEOUT. Retries stay single-sourced (`maxRetries: 0` below).
const ANTHROPIC_CLIENT_TIMEOUT_MARGIN_MS = 1_000;

export class LiveProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveProviderConfigurationError";
  }
}

/** Exactly the fields we pass to client.messages.parse. No vendor types in this signature. */
export type AnthropicParseRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: [{ role: "user"; content: string }];
  output_config: { format: unknown; effort: "low" | "medium" | "high" };
};

/**
 * T-996 review finding 2: this is deliberately the raw `messages.create`
 * response shape, not the SDK's client-side-parsed `ParsedMessage`. The SDK's
 * `messages.parse` calls `outputFormat.parse(text)` internally and *throws* a
 * plain `AnthropicError` (not an `APIError` subclass) on a refusal, a
 * `max_tokens` truncation or any schema-invalid JSON — none of those are
 * `instanceof APIConnectionError/RateLimitError/APIError`, so
 * `mapAnthropicTransportError` could not distinguish them from a real
 * transport failure, and they would retry `maxAttempts` times with real spend
 * and a discarded (zero) usage record. Using `create` and doing our own
 * best-effort JSON.parse in `invoke` (see below) keeps parsing outside the
 * transport's try/catch entirely, so `usage` is always the real API usage and
 * a bad completion fails closed once (`attempts === 1`), per spec step 8.
 */
export type AnthropicMessageContentBlock = { type: string; text?: string };
export type AnthropicMessageResponse = {
  content: AnthropicMessageContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
};

export type AnthropicTransport = (
  request: AnthropicParseRequest,
  options: { signal: AbortSignal }
) => Promise<AnthropicMessageResponse>;

type AnthropicModule = typeof import("@anthropic-ai/sdk");
type AnthropicZodHelperModule = typeof import("@anthropic-ai/sdk/helpers/zod");

// Resolved once and cached in module scope. instanceof checks against
// error classes and the zodOutputFormat helper always come from this same
// dynamic import — never a second import, never string matching on error
// messages.
let anthropicModulePromise: Promise<AnthropicModule> | null = null;
function loadAnthropicModule(): Promise<AnthropicModule> {
  anthropicModulePromise ??= import("@anthropic-ai/sdk");
  return anthropicModulePromise;
}

let anthropicZodHelperModulePromise: Promise<AnthropicZodHelperModule> | null = null;
function loadAnthropicZodHelperModule(): Promise<AnthropicZodHelperModule> {
  anthropicZodHelperModulePromise ??= import("@anthropic-ai/sdk/helpers/zod");
  return anthropicZodHelperModulePromise;
}

const ALLOWED_LIST_LABELS: readonly [keyof ConstrainedProviderEnvelope["allowed"], string][] = [
  ["optionIds", "Allowed option IDs"],
  ["preferenceIds", "Allowed preference IDs"],
  ["clarificationIds", "Allowed clarification IDs"],
  ["explanationTemplateIds", "Allowed explanation template IDs"],
  ["reasonCodes", "Allowed reason codes"],
  ["numericFieldIds", "Allowed numeric field IDs"],
  ["limitationIds", "Allowed limitation IDs"],
];

/**
 * T-2006 seam: appends prose rules here, and only here, plus the matching
 * fields in `constrainedProviderOutputObjectSchema` (adapter.ts). A second
 * output schema, a second prompt builder or a second provider class is a
 * review CHANGES.
 */
export const OUTPUT_CONTRACT_RULES = [
  "Return exactly one JSON object that matches the provided output schema and nothing else.",
  "preferenceIds must be a subset of the allowed preference IDs; never invent an ID.",
  "rankedOptionIds must be a subset of the allowed option IDs; never invent an ID.",
  "explanation.templateId must be exactly one of the allowed explanation template IDs.",
  "explanation.reasonCodes must contain every allowed reason code exactly once, in any order.",
  "explanation.limitationIds must contain every allowed limitation ID exactly once, in any order.",
  "explanation.numericFieldIds must be a subset of the allowed numeric field IDs.",
  "concern.clarificationId is one of the allowed clarification IDs only when concern.disposition is REQUEST_CLARIFICATION; otherwise it is null.",
  "Never invent an ID, fact, number, name or claim that is not present in the allowed lists above.",
  ...PROSE_SYSTEM_RULES,
] as const;

/** Pure. Deterministic. Contains the allowed IDs and the task contract; never client text. */
export function buildConstrainedSystemPrompt(envelope: ConstrainedProviderEnvelope): string {
  const lines: string[] = [
    "You are the constrained selection engine for a nutrition and fitness coaching product.",
    `Task: ${envelope.task}`,
    "You have no tools, no browsing, no retrieval and no memory of other clients. Select only from the server-owned allowed IDs below.",
    "",
  ];
  for (const [field, label] of ALLOWED_LIST_LABELS) {
    lines.push(`${label}: ${JSON.stringify(envelope.allowed[field])}`);
  }
  if (envelope.explanationInputs) {
    lines.push(`Explanation outcome: ${envelope.explanationInputs.outcome}`);
    lines.push(
      `Explanation numeric fields (id, value, unit, displayLabel, displayValue): ${JSON.stringify(
        envelope.explanationInputs.numericFields
      )}`
    );
    lines.push(
      `Explanation display names (optionId, name): ${JSON.stringify(
        envelope.explanationInputs.displayNames
      )}`
    );
    lines.push(`Explanation character budget: ${envelope.explanationInputs.maxCharacters}`);
  }
  lines.push("");
  lines.push("Output contract:");
  for (const rule of OUTPUT_CONTRACT_RULES) {
    lines.push(`- ${rule}`);
  }
  return lines.join("\n");
}

/** Pure. The only object ever serialized into the user turn. */
export function minimizedUserPayload(envelope: ConstrainedProviderEnvelope): {
  task: "INTERPRET_RANK_EXPLAIN";
  currentClientLanguage: { id: string; text: string }[];
  allowed: ConstrainedProviderEnvelope["allowed"];
  capabilities: ConstrainedProviderEnvelope["capabilities"];
  explanationInputs?: NonNullable<ConstrainedProviderEnvelope["explanationInputs"]>;
} {
  return {
    task: "INTERPRET_RANK_EXPLAIN",
    currentClientLanguage: envelope.currentClientLanguage.map((item) => ({
      id: item.id,
      text: item.text,
    })),
    allowed: envelope.allowed,
    capabilities: envelope.capabilities,
    // Omitted entirely (not sent as `null`) when absent, so a caller that
    // never opts into prose keeps sending exactly the four-key payload the
    // envelope has always sent — asserted by the pre-T-2006 live-provider
    // test's `Object.keys(payload)` check. `catalogVocabulary` never
    // reaches this object; it is not a field of `explanationInputs`.
    ...(envelope.explanationInputs != null
      ? { explanationInputs: envelope.explanationInputs }
      : {}),
  };
}

/** Pure. Asserted by test; never constructs a client itself. */
export function anthropicClientOptions(
  release: ActiveAiCoachLiveRelease,
  credential: string
): { apiKey: string; authToken: null; baseURL: string; timeout: number; maxRetries: 0 } {
  return {
    apiKey: credential,
    authToken: null,
    baseURL: ANTHROPIC_API_BASE_URL,
    timeout: release.runtimeConfiguration.provider.timeoutMs + ANTHROPIC_CLIENT_TIMEOUT_MARGIN_MS,
    maxRetries: 0,
  };
}

function nonNegativeFiniteOrZero(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Never includes the vendor's own message, request ID, credential, prompt or completion. */
async function mapAnthropicTransportError(error: unknown): Promise<Error> {
  const anthropic = await loadAnthropicModule();
  const isRetryableTransportFailure =
    error instanceof anthropic.APIConnectionError ||
    error instanceof anthropic.RateLimitError ||
    (error instanceof anthropic.APIError &&
      typeof error.status === "number" &&
      error.status >= 500);
  if (isRetryableTransportFailure) {
    return new Error("The approved provider call failed.");
  }
  const isConfigurationRejection =
    error instanceof anthropic.APIError &&
    typeof error.status === "number" &&
    ([400, 401, 402, 403, 404, 413] as const).includes(
      error.status as 400 | 401 | 402 | 403 | 404 | 413
    );
  if (isConfigurationRejection) {
    return new LiveProviderConfigurationError(
      "The approved provider rejected the request configuration."
    );
  }
  return new Error("The approved provider call failed.");
}

/**
 * Stop reasons that must fail closed rather than attempt a parse: `refusal`
 * (prose, not JSON), `max_tokens`/`model_context_window_exceeded` (truncated
 * JSON) and `pause_turn` (an incomplete turn we never resume — no tools, no
 * multi-turn agentic loop in this boundary).
 */
const FAIL_CLOSED_STOP_REASONS = new Set([
  "refusal",
  "max_tokens",
  "model_context_window_exceeded",
  "pause_turn",
]);

/**
 * Never throws. Returns `null` on a refusal, a truncated/paused turn, a
 * missing text block, a raw response over the byte cap (checked before
 * parsing, matching the deleted gateway's pre-parse ingress cap), or JSON
 * that fails to parse. `validateConstrainedProviderOutput` (adapter.ts) is
 * still the schema/refinement authority for whatever this returns.
 */
function extractFailClosedOutput(response: AnthropicMessageResponse): unknown {
  if (FAIL_CLOSED_STOP_REASONS.has(response.stop_reason ?? "")) return null;
  const textBlock = response.content.find(
    (block): block is AnthropicMessageContentBlock & { text: string } =>
      block.type === "text" && typeof block.text === "string"
  );
  if (!textBlock) return null;
  if (Buffer.byteLength(textBlock.text) > MAX_PROVIDER_OUTPUT_BYTES) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return null;
  }
}

export class AnthropicConstrainedProvider implements ConstrainedModelProvider {
  constructor(
    private readonly release: ActiveAiCoachLiveRelease,
    private readonly transport: AnthropicTransport,
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
    if (
      contentHash(this.release.runtimeConfiguration) !== this.release.runtimeConfigurationDigest
    ) {
      throw new LiveProviderConfigurationError("The runtime configuration digest changed.");
    }
    const provider = this.release.runtimeConfiguration.provider;
    if (provider.vendor !== "ANTHROPIC" || provider.apiBaseUrl !== ANTHROPIC_API_BASE_URL) {
      throw new LiveProviderConfigurationError(
        "The approved provider configuration is not the approved Anthropic configuration."
      );
    }
    const token = this.credential()?.trim();
    if (!token) {
      throw new LiveProviderConfigurationError("The approved provider credential is unavailable.");
    }

    const { zodOutputFormat } = await loadAnthropicZodHelperModule();
    const request: AnthropicParseRequest = {
      model: provider.modelIdentifier,
      max_tokens: Math.min(provider.maxOutputTokens, MAX_NON_STREAMING_OUTPUT_TOKENS),
      system: buildConstrainedSystemPrompt(envelope),
      messages: [{ role: "user", content: JSON.stringify(minimizedUserPayload(envelope)) }],
      output_config: {
        format: zodOutputFormat(constrainedProviderOutputObjectSchema),
        effort: provider.effort,
      },
    };

    let response: AnthropicMessageResponse;
    try {
      response = await this.transport(request, { signal: context.signal });
    } catch (error) {
      // Only genuine transport/HTTP failures reach here now (APIConnectionError,
      // RateLimitError, APIError with a status) — parsing happens below, outside
      // this try/catch, so a refusal/truncation/bad-JSON completion never throws.
      throw await mapAnthropicTransportError(error);
    }

    const inputTokens =
      nonNegativeFiniteOrZero(response.usage.input_tokens) +
      nonNegativeFiniteOrZero(response.usage.cache_creation_input_tokens ?? 0) +
      nonNegativeFiniteOrZero(response.usage.cache_read_input_tokens ?? 0);
    const outputTokens = nonNegativeFiniteOrZero(response.usage.output_tokens);
    const spendMinorUnits = estimateSpendMinorUnits(
      { inputTokens, outputTokens },
      provider.pricing
    );
    const usage = { inputTokens, outputTokens, spendMinorUnits };

    const output = extractFailClosedOutput(response);

    return constrainedTransportResponseSchema.parse({ output, usage });
  }
}

// Type-only references, erased at compile time — not a runtime import, so
// this does not appear as a static `@anthropic-ai/sdk` import in the build.
// `MessageCreateParamsNonStreaming`/`OutputConfig` are declared inside the
// `Anthropic` namespace merge (client.d.ts), not at the module's top level.
type AnthropicMessageCreateParamsNonStreaming =
  import("@anthropic-ai/sdk").Anthropic.MessageCreateParamsNonStreaming;
type AnthropicOutputConfig = import("@anthropic-ai/sdk").Anthropic.OutputConfig;

/**
 * Exported so callers that build their own `ActiveAiCoachLiveRelease`-shaped
 * value outside the DB-backed loader (e.g. `scripts/evaluate-ai-coach-final-provider.ts`)
 * construct the transport through the same path as `loadAnthropicConstrainedProvider`'s
 * default, instead of a second `new Anthropic(...)` that could silently diverge
 * on timeout, retries, baseURL or credential source.
 */
export async function defaultAnthropicTransportFactory(
  release: ActiveAiCoachLiveRelease,
  credential: string
): Promise<AnthropicTransport> {
  const { default: Anthropic } = await loadAnthropicModule();
  const client = new Anthropic(anthropicClientOptions(release, credential));
  return async (request, options) => {
    // The only cast left is `output_config.format`, which is exactly as
    // specific as `AnthropicParseRequest` (our SDK-vendor-type-free public
    // signature) can be — `zodOutputFormat(...)`'s return value structurally
    // *is* a `JSONOutputFormat`, so this is a widening cast on a known-good
    // shape, not an escape hatch for the rest of the request. Every other
    // field (`model`, `max_tokens`, `system`, `messages`) is passed through
    // untouched and statically checked against the real SDK params type.
    const params: AnthropicMessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system,
      messages: request.messages,
      output_config: request.output_config as AnthropicOutputConfig,
    };
    const message = await client.messages.create(params, { signal: options.signal });
    return message;
  };
}

/** Server-selected live provider. Same shape loadApprovedConstrainedGatewayProvider returned. */
export async function loadAnthropicConstrainedProvider(
  transportFactory: (
    release: ActiveAiCoachLiveRelease,
    credential: string
  ) => AnthropicTransport | Promise<AnthropicTransport> = defaultAnthropicTransportFactory
): Promise<{
  release: ActiveAiCoachLiveRelease;
  provider: AnthropicConstrainedProvider;
  executionPolicy: ConstrainedProviderExecutionPolicy;
}> {
  await assertAiCoachOperationEnabled("PROVIDER");
  const release = await assertActiveAiCoachLiveReleaseReady();
  // Read once. A single credential value is threaded into both the SDK
  // client (via transportFactory) and the provider's own re-check in
  // invoke() (constructor's third argument), so the two can never observe
  // different values (a rotation mid-request) and the client is never
  // constructed with an empty apiKey.
  const credential = process.env.AI_COACH_PROVIDER_CREDENTIAL?.trim();
  if (!credential) {
    throw new LiveProviderConfigurationError("The approved provider credential is unavailable.");
  }
  const transport = await transportFactory(release, credential);
  return {
    release,
    provider: new AnthropicConstrainedProvider(release, transport, () => credential),
    executionPolicy: {
      timeoutMs: release.runtimeConfiguration.provider.timeoutMs,
      maxAttempts: release.runtimeConfiguration.provider.maxAttempts,
      retryDelaysMs: release.runtimeConfiguration.provider.retryDelaysMs,
      maxInputTokens: release.runtimeConfiguration.provider.maxInputTokens,
      maxOutputTokens: release.runtimeConfiguration.provider.maxOutputTokens,
    },
  };
}
