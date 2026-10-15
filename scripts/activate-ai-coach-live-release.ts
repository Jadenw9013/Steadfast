import { activateAiCoachLiveRelease } from "../lib/ai-coach/live-launch/repository";

function requiredArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

async function main() {
  const packetId = requiredArgument("--packet-id");
  const actorUserId = requiredArgument("--actor-user-id");
  const signedActivationRef = requiredArgument("--signed-activation-ref");
  const reasonCode = requiredArgument("--reason-code");
  const activation = await activateAiCoachLiveRelease({
    packetId,
    actorUserId,
    signedActivationRef,
    reasonCode,
  });
  console.log(
    JSON.stringify({
      activated: true,
      activationId: activation.id,
      packetId: activation.packetId,
      releaseId: activation.releaseId,
      packetDigest: activation.packetDigest,
      runtimeConfigurationDigest: activation.runtimeConfigurationDigest,
    })
  );
}

void main();
