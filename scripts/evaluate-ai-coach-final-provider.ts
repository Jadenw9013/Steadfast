import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { contentHash } from "../lib/ai-coach/canonical-json";
import {
  callConstrainedProvider,
  constrainedProviderEnvelopeSchema,
} from "../lib/ai-coach/provider/adapter";
import {
  AnthropicConstrainedProvider,
  defaultAnthropicTransportFactory,
} from "../lib/ai-coach/provider/anthropic-provider";
import { liveLaunchPacketSchema } from "../lib/ai-coach/live-launch/schema";

const corpusSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusVersion: z.literal("ai-coach-final-provider-synthetic-v1"),
    syntheticOnly: z.literal(true),
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            category: z.string().min(1).max(160),
            clientLanguage: z.string().min(1).max(1_000),
          })
          .strict()
      )
      .min(8),
  })
  .strict();

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error(
      "Refused: pass --execute only after provider privacy/security approval for the exact packet."
    );
  }
  const packetPath = argument("--packet");
  const outputPath = argument("--output");
  if (!packetPath || !outputPath)
    throw new Error("Usage: --execute --packet <candidate.json> --output <evidence.json>");
  const packet = liveLaunchPacketSchema.parse(
    JSON.parse(await readFile(resolve(packetPath), "utf8"))
  );
  if (packet.testOnly || !packet.runtimeConfiguration || !packet.runtimeConfigurationDigest)
    throw new Error("A non-test packet with an exact runtime configuration is required.");
  if (contentHash(packet.runtimeConfiguration) !== packet.runtimeConfigurationDigest)
    throw new Error("Runtime configuration digest mismatch.");
  const now = new Date();
  for (const requirement of ["PROVIDER_PRIVACY_SECURITY", "SLO_AND_SPEND_LIMITS"] as const) {
    const approval = packet.approvals.find((item) => item.requirement === requirement);
    if (
      !approval ||
      approval.status !== "APPROVED" ||
      approval.requiredHumanDecision !== null ||
      approval.subjectReleaseId !== packet.releaseId ||
      approval.subjectConfigurationDigest !== packet.runtimeConfigurationDigest ||
      !approval.signature ||
      approval.signature.digest !== approval.recordDigest ||
      !approval.signedAt ||
      new Date(approval.signedAt) > now ||
      !approval.expiresAt ||
      new Date(approval.expiresAt) <= now
    )
      throw new Error(`Current signed ${requirement} approval is required before provider I/O.`);
  }
  if (!process.env.AI_COACH_PROVIDER_CREDENTIAL?.trim())
    throw new Error("AI_COACH_PROVIDER_CREDENTIAL is required.");

  const corpusBytes = await readFile(
    resolve("tests/fixtures/ai-coach/final-provider-evaluation-v1.json")
  );
  const corpus = corpusSchema.parse(JSON.parse(corpusBytes.toString("utf8")));
  if (new Set(corpus.cases.map((item) => item.id)).size !== corpus.cases.length)
    throw new Error("Final-provider corpus IDs must be unique.");
  const configuration = packet.runtimeConfiguration;
  const release = {
    activationId: "preactivation-final-provider-evaluation",
    packetId: packet.packetId,
    releaseId: packet.releaseId,
    packetDigest: contentHash(packet),
    engineVersion: packet.engineVersion,
    jurisdictions: packet.jurisdictions,
    expiresAt: now,
    runtimeConfigurationDigest: packet.runtimeConfigurationDigest,
    runtimeConfiguration: configuration,
    artifactBindings: packet.artifactBindings,
  };
  const credential = process.env.AI_COACH_PROVIDER_CREDENTIAL ?? "";
  const transport = await defaultAnthropicTransportFactory(release, credential);
  const provider = new AnthropicConstrainedProvider(release, transport);
  const results = [];
  for (const testCase of corpus.cases) {
    const envelope = constrainedProviderEnvelopeSchema.parse({
      schemaVersion: 1,
      operationId: randomUUID(),
      promptContractVersion: configuration.providerBoundary.promptContractVersion,
      task: "INTERPRET_RANK_EXPLAIN",
      currentClientLanguage: [
        {
          id: `synthetic-evaluation-${testCase.id}`,
          text: testCase.clientLanguage,
          provenance: "CURRENT_CLIENT_VALIDATED",
        },
      ],
      allowed: {
        optionIds: ["FOOD:SYNTHETIC_EVALUATION_OPTION"],
        preferenceIds: configuration.providerBoundary.allowedPreferenceIds,
        clarificationIds: configuration.providerBoundary.allowedClarificationIds,
        explanationTemplateIds: ["SYNTHETIC_EVALUATION_TEMPLATE"],
        reasonCodes: ["GATE_APPROVED"],
        numericFieldIds: [],
        limitationIds: configuration.providerBoundary.limitations.map((item) => item.id),
      },
      capabilities: {
        tools: [],
        browsing: false,
        rag: false,
        liveResearch: false,
        crossClientMemory: false,
      },
    });
    const result = await callConstrainedProvider(provider, envelope, {
      timeoutMs: configuration.provider.timeoutMs,
      maxAttempts: configuration.provider.maxAttempts,
      retryDelaysMs: configuration.provider.retryDelaysMs,
      maxInputTokens: configuration.provider.maxInputTokens,
      maxOutputTokens: configuration.provider.maxOutputTokens,
    });
    results.push({
      id: testCase.id,
      category: testCase.category,
      passed: result.ok,
      failureCode: result.ok ? null : result.failureCode,
      attempts: result.measurement.attempts,
      totalLatencyMs: result.measurement.totalLatencyMs,
      totalRetryDelayMs: result.measurement.totalRetryDelayMs,
      inputTokens: result.measurement.inputTokens,
      outputTokens: result.measurement.outputTokens,
      totalSpendMinorUnits: result.measurement.totalSpendMinorUnits,
    });
  }
  const evidence = {
    schemaVersion: 1,
    evidenceType: "REAL_PROVIDER_EVALUATION_CANDIDATE",
    authorizationEffect: "NONE",
    packetId: packet.packetId,
    packetDigest: contentHash(packet),
    releaseId: packet.releaseId,
    runtimeConfigurationDigest: packet.runtimeConfigurationDigest,
    corpusVersion: corpus.corpusVersion,
    corpusDigest: createHash("sha256").update(corpusBytes).digest("hex"),
    observedAt: new Date().toISOString(),
    passed: results.every((result) => result.passed),
    totals: {
      cases: results.length,
      passed: results.filter((result) => result.passed).length,
      attempts: results.reduce((sum, result) => sum + result.attempts, 0),
      totalLatencyMs: results.reduce((sum, result) => sum + result.totalLatencyMs, 0),
      totalRetryDelayMs: results.reduce((sum, result) => sum + result.totalRetryDelayMs, 0),
      inputTokens: results.reduce((sum, result) => sum + result.inputTokens, 0),
      outputTokens: results.reduce((sum, result) => sum + result.outputTokens, 0),
      totalSpendMinorUnits: results.reduce((sum, result) => sum + result.totalSpendMinorUnits, 0),
      p95LatencyMs: [...results].sort((left, right) => left.totalLatencyMs - right.totalLatencyMs)[
        Math.ceil(results.length * 0.95) - 1
      ]!.totalLatencyMs,
    },
    results,
    requiredAttestation:
      "REQUIRED HUMAN DECISION: authorized reviewer must review and externally sign this exact evidence digest before packet inclusion.",
  };
  await writeFile(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  if (!evidence.passed) process.exitCode = 1;
}

void main();
