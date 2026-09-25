import { deactivateAiCoachLiveRelease } from "../lib/ai-coach/live-launch/repository";

function requiredArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

async function main() {
  const deactivated = await deactivateAiCoachLiveRelease({
    actorUserId: requiredArgument("--actor-user-id"),
    signedActivationRef: requiredArgument("--signed-activation-ref"),
    reasonCode: requiredArgument("--reason-code"),
    reason: requiredArgument("--reason"),
    incidentReference: process.argv.includes("--incident-reference")
      ? requiredArgument("--incident-reference")
      : null,
  });
  console.log(
    JSON.stringify({
      deactivated: true,
      activationId: deactivated.id,
      packetId: deactivated.packetId,
      releaseId: deactivated.releaseId,
      revision: deactivated.revision,
    })
  );
}

void main();
