import { bootstrapGovernanceGrant } from "../lib/ai-coach/grants";
import { AiCoachError } from "../lib/ai-coach/error";

function requiredArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  // T-995 r2 NIT/P4 — a usage error (missing argument), not UNKNOWN_ERROR.
  if (!value) throw new AiCoachError("VALIDATION_ERROR", `Missing required argument: ${name}`, 422);
  return value;
}

async function main() {
  const confirmBootstrap = process.argv.includes("--confirm-bootstrap");
  const userId = requiredArgument("--user-id");
  const grantRef = requiredArgument("--grant-ref");
  const actorRef = requiredArgument("--actor-ref");
  const reasonCode = requiredArgument("--reason-code");
  // The service (never this script) is the source of truth on whether
  // `--confirm-bootstrap` was required and present; the boolean is passed
  // through as-is, including when the flag was absent.
  const result = await bootstrapGovernanceGrant({
    userId,
    grantRef,
    actorRef,
    reasonCode,
    confirmBootstrap: confirmBootstrap as true,
  });
  console.log(JSON.stringify(result));
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
