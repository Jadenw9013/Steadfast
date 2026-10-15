import {
  grantGovernanceGrant,
  revokeGovernanceGrant,
  grantReviewerGrant,
  revokeReviewerGrant,
  grantClientEntitlement,
  revokeClientEntitlement,
} from "../lib/ai-coach/grants";
import { AiCoachError } from "../lib/ai-coach/error";
import type { GovernanceScope } from "../lib/ai-coach/operations";

function requiredArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  // T-995 r2 NIT/P4 — a usage error (missing argument), not UNKNOWN_ERROR.
  if (!value) throw new AiCoachError("VALIDATION_ERROR", `Missing required argument: ${name}`, 422);
  return value;
}

function optionalArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

// T-995 r2 NIT/P4 — the frozen contract types `expiresAt` as `Date | null`, so
// once parsed there is no way to tell "2026-12-31" (locale-dependent
// midnight) apart from a genuine ISO instant; the format must be checked
// against the raw string, here, before `new Date(...)` ever runs.
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
function parseIsoInstant(name: string, raw: string): Date {
  if (!ISO_INSTANT_RE.test(raw))
    throw new AiCoachError(
      "VALIDATION_ERROR",
      `${name} must be an ISO-8601 instant (e.g. 2026-12-31T00:00:00.000Z).`,
      422
    );
  return new Date(raw);
}

function splitList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const COMMANDS = [
  "grant-governance",
  "revoke-governance",
  "grant-reviewer",
  "revoke-reviewer",
  "grant-entitlement",
  "revoke-entitlement",
] as const;

async function main() {
  const command = process.argv[2];
  switch (command) {
    case "grant-governance": {
      const scopes = splitList(requiredArgument("--scopes")) as GovernanceScope[];
      const result = await grantGovernanceGrant({
        actorUserId: requiredArgument("--actor-user-id"),
        userId: requiredArgument("--user-id"),
        scopes,
        grantRef: requiredArgument("--grant-ref"),
        actorRef: requiredArgument("--actor-ref"),
        reasonCode: requiredArgument("--reason-code"),
      });
      console.log(JSON.stringify(result));
      return;
    }
    case "revoke-governance": {
      const result = await revokeGovernanceGrant({
        actorUserId: requiredArgument("--actor-user-id"),
        userId: requiredArgument("--user-id"),
        actorRef: requiredArgument("--actor-ref"),
        reasonCode: requiredArgument("--reason-code"),
      });
      console.log(JSON.stringify(result));
      return;
    }
    case "grant-reviewer": {
      const clientIds = splitList(requiredArgument("--client-ids"));
      const domains = splitList(requiredArgument("--domains")) as (
        | "NUTRITION"
        | "STRENGTH"
        | "CARDIO"
      )[];
      const result = await grantReviewerGrant({
        actorUserId: requiredArgument("--actor-user-id"),
        userId: requiredArgument("--user-id"),
        clientIds,
        domains,
        qualificationNote: requiredArgument("--qualification-note"),
        actorRef: requiredArgument("--actor-ref"),
        reasonCode: requiredArgument("--reason-code"),
      });
      console.log(JSON.stringify(result));
      return;
    }
    case "revoke-reviewer": {
      const result = await revokeReviewerGrant({
        actorUserId: requiredArgument("--actor-user-id"),
        userId: requiredArgument("--user-id"),
        actorRef: requiredArgument("--actor-ref"),
        reasonCode: requiredArgument("--reason-code"),
      });
      console.log(JSON.stringify(result));
      return;
    }
    case "grant-entitlement": {
      const expiresAtRaw = optionalArgument("--expires-at");
      const result = await grantClientEntitlement({
        actorUserId: requiredArgument("--actor-user-id"),
        clientId: requiredArgument("--client-id"),
        expiresAt: expiresAtRaw ? parseIsoInstant("--expires-at", expiresAtRaw) : null,
        actorRef: requiredArgument("--actor-ref"),
        reasonCode: requiredArgument("--reason-code"),
      });
      console.log(JSON.stringify(result));
      return;
    }
    case "revoke-entitlement": {
      const result = await revokeClientEntitlement({
        actorUserId: requiredArgument("--actor-user-id"),
        clientId: requiredArgument("--client-id"),
        actorRef: requiredArgument("--actor-ref"),
        reasonCode: requiredArgument("--reason-code"),
      });
      console.log(JSON.stringify(result));
      return;
    }
    default: {
      console.error(
        `Unknown command: ${command ?? "<none>"}. Expected one of: ${COMMANDS.join(", ")}`
      );
      process.exitCode = 1;
      return;
    }
  }
}

main().catch((error) => {
  if (error instanceof AiCoachError) {
    console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ok: false, code: "UNKNOWN_ERROR", message }));
  }
  process.exitCode = 1;
});
