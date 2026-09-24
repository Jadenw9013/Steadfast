import { getAiCoachOperationalMonitoring } from "../lib/ai-coach/operations";

function actorUserId() {
  const index = process.argv.indexOf("--actor-user-id");
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error("Usage: --actor-user-id <governance user id>");
  return value;
}

async function main() {
  const monitoring = await getAiCoachOperationalMonitoring(actorUserId());
  console.log(
    JSON.stringify({
      schemaVersion: monitoring.schemaVersion,
      window: monitoring.window,
      liveRelease: monitoring.liveRelease,
      alerts: monitoring.alerts,
      providerMeasurements: monitoring.providerMeasurements,
    })
  );
  if (monitoring.alerts.status !== "OK") process.exitCode = 1;
}

void main();
