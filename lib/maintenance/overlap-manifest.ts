import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { z } from "zod";

/**
 * T-2059 r2 (review r1 finding 1) — the overlap manifest.
 *
 * `reconcile-coaching-context.ts --apply` clears a stale `resolutionRequired`
 * flag so a client gets their surviving coach back. That flag was the only
 * durable record that the client once had 2+ CoachClient rows at the same time,
 * and the T-661 message backfill relies on it to refuse such clients. Once it
 * is cleared, nothing in the database remembers the overlap, so a reply the
 * client wrote to the departed coach could be attributed to the survivor.
 *
 * So before it writes anything, every D1 --apply records here each client it
 * is about to move out of STALE_RESOLUTION, plus every client it can see with
 * 2+ CoachClient rows. The file is cumulative (a second apply merges, it never
 * forgets) and keyed to one `host/db`. `reattribute-message-coach.ts` refuses
 * to run without it and excludes every listed client entirely.
 *
 * Contents are client ids and reasons only, no emails or names.
 *
 * r3 (review T-2059-r2 finding 1): the manifest can no longer be silently
 * re-created. Only the first D1 apply of a deploy passes `--init-manifest`,
 * which refuses if the directory already holds one; every other D1 apply
 * refuses unless the manifest exists and matches host/db. So a lost or wrong
 * directory fails closed instead of producing a fresh manifest that has
 * forgotten every client an earlier apply cleared. D3 --apply is one-shot: it
 * stamps `d3AppliedAt` and refuses a second apply against the same manifest.
 */

export const MANIFEST_FILENAME = "coaching-context-overlap-manifest.json";

export const OVERLAP_REASONS = ["STALE_RESOLUTION_CLEARED", "MULTIPLE_COACHCLIENT_ROWS"] as const;
export type OverlapReason = (typeof OVERLAP_REASONS)[number];

const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const manifestSchema = z.object({
  version: z.literal(1),
  target: z.string().min(1),
  updatedAt: z.string(),
  d3AppliedAt: z.string().optional(),
  clients: z.array(
    z.object({
      clientId: z.string().regex(CLIENT_ID),
      reasons: z.array(z.enum(OVERLAP_REASONS)).min(1),
      firstSeenAt: z.string(),
    })
  ),
});
export type OverlapManifest = z.infer<typeof manifestSchema>;

export function manifestPathFor(runDir: string): string {
  return path.join(runDir, MANIFEST_FILENAME);
}

export function readOverlapManifest(file: string, expectedTarget: string): OverlapManifest {
  if (!existsSync(file)) {
    throw new Error(`Overlap manifest not found at ${file}. Run scripts/reconcile-coaching-context.ts --apply with the same --run-dir first.`);
  }
  const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`Overlap manifest at ${file} is malformed; refusing.`);
  if (parsed.data.target !== expectedTarget) {
    throw new Error(`Overlap manifest at ${file} was written for ${parsed.data.target}, not ${expectedTarget}; refusing.`);
  }
  return parsed.data;
}

/** Merge new entries into the manifest (creating it if needed). Never removes an entry. */
function writeManifest(file: string, manifest: OverlapManifest) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function recordOverlapClients(
  runDir: string,
  target: string,
  entries: ReadonlyArray<{ clientId: string; reason: OverlapReason }>,
  { init }: { init: boolean }
): { file: string; manifest: OverlapManifest; added: number } {
  const file = manifestPathFor(runDir);
  const exists = existsSync(file);
  if (init && exists) {
    throw new Error(`--init-manifest refused: ${file} already exists. Reuse it (drop --init-manifest); never start a second manifest for the same deploy.`);
  }
  if (!init && !exists) {
    throw new Error(
      `No overlap manifest at ${file}. Use the deploy's existing run directory. Only the first apply of a deploy (immediately before promotion) passes --init-manifest.`
    );
  }
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();
  const manifest: OverlapManifest = exists ? readOverlapManifest(file, target) : { version: 1, target, updatedAt: now, clients: [] };
  const byId = new Map(manifest.clients.map((c) => [c.clientId, c]));
  let added = 0;
  for (const { clientId, reason } of entries) {
    if (!CLIENT_ID.test(clientId)) throw new Error(`Refusing to record an unexpected client id shape: ${clientId}`);
    const existing = byId.get(clientId);
    if (!existing) {
      byId.set(clientId, { clientId, reasons: [reason], firstSeenAt: now });
      added += 1;
    } else if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
  }
  const next: OverlapManifest = {
    version: 1,
    target,
    updatedAt: now,
    ...(manifest.d3AppliedAt ? { d3AppliedAt: manifest.d3AppliedAt } : {}),
    clients: [...byId.values()].sort((a, b) => a.clientId.localeCompare(b.clientId)),
  };
  writeManifest(file, next);
  return { file, manifest: next, added };
}

/** D3 --apply is one-shot per manifest: stamp completion after the commit. */
export function markD3Applied(file: string, target: string): OverlapManifest {
  const manifest = readOverlapManifest(file, target);
  const next = { ...manifest, d3AppliedAt: new Date().toISOString() };
  writeManifest(file, next);
  return next;
}
