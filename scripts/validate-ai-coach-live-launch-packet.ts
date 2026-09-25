import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contentHash } from "../lib/ai-coach/canonical-json";
import {
  evaluateLiveLaunchPacketReadiness,
  liveLaunchPacketSchema,
} from "../lib/ai-coach/live-launch/schema";

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const file = args[1];
  if (!file || !["--draft", "--readiness"].includes(mode)) {
    console.error(
      "Usage: tsx scripts/validate-ai-coach-live-launch-packet.ts --draft|--readiness <packet.json>"
    );
    process.exit(2);
  }

  const raw = JSON.parse(await readFile(resolve(process.cwd(), file), "utf8")) as unknown;
  const packet = liveLaunchPacketSchema.parse(raw);
  const sourceMismatches: string[] = [];
  for (const source of packet.sourceRecords) {
    const sourcePath = source.path.startsWith("steadfast-hq/")
      ? resolve(process.cwd(), "..", source.path)
      : resolve(process.cwd(), source.path);
    try {
      const digest = createHash("sha256")
        .update(await readFile(sourcePath))
        .digest("hex");
      if (digest !== source.digest) sourceMismatches.push(source.id);
    } catch {
      sourceMismatches.push(source.id);
    }
  }
  if (sourceMismatches.length > 0) {
    console.error(`Source record verification failed: ${sourceMismatches.join(", ")}`);
    process.exit(1);
  }

  console.log(`Packet schema: PASS`);
  console.log(`Packet content digest: ${contentHash(packet)}`);
  console.log(`Source record digests: PASS (${packet.sourceRecords.length})`);
  if (mode === "--draft") return;

  const readiness = evaluateLiveLaunchPacketReadiness(packet, {
    packetId: packet.packetId,
    releaseId: packet.releaseId,
    engineVersion: packet.engineVersion,
    jurisdictions: packet.jurisdictions,
  });
  if (!readiness.ready) {
    console.error("Live-launch readiness: BLOCKED");
    for (const reason of readiness.reasons) console.error(`- ${reason.code}: ${reason.subject}`);
    process.exit(1);
  }
  console.log("Live-launch readiness: PASS");
}

void main();
