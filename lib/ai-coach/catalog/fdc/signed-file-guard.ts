/**
 * S-31 review round 1, finding 5.
 *
 * `scripts/ai-coach-ingest-fdc.ts` used to write its `--out` path with a
 * bare `fs.writeFileSync`, and the catalog README pointed `--out` at the
 * *signed* v1 file as its own documented example. A re-ingest run would
 * silently overwrite a signed artifact in place, downgrading its
 * `reviewMetadata.decision` from `APPROVED` to `DRAFT_UNSIGNED`.
 *
 * Pulled out of the CLI script into a pure module (no fs, no network, no
 * `process.env`) so it is unit-testable without executing the CLI's `main()`
 * — importing `scripts/ai-coach-ingest-fdc.ts` directly runs the script.
 */
export function isSignedFoodCatalogFile(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const reviewMetadata = (parsed as { reviewMetadata?: unknown }).reviewMetadata;
  if (typeof reviewMetadata !== "object" || reviewMetadata === null) return false;
  return (reviewMetadata as { decision?: unknown }).decision === "APPROVED";
}
