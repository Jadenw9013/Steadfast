import { expect } from "vitest";
import type { DraftFoodCatalogFile } from "@/lib/ai-coach/artifacts/drafts/loader";

/**
 * The invariant the spec asks for over the draft artifact: exactly one
 * provenance entry per item, every `parameterId` an item ID, so an item
 * silently dropped between mapping and envelope assembly is caught.
 *
 * Shared (S-31 review round 1, finding 1): originally local to
 * `tests/unit/ai-coach-fdc-allowlist.test.ts`. v1 satisfied it 232/232; the
 * first version of v2 did not (24 provenance rows for 256 items) because the
 * new test asserted a weaker, sibling check instead of reusing this one. It
 * is pulled out here so both the v1 and v2 draft-catalog tests point at the
 * exact same checker rather than two assertions that could silently drift
 * apart again.
 */
export function assertProvenanceCoversEveryItem(file: DraftFoodCatalogFile): void {
  const itemIds = file.content.items.map((item) => item.id);
  const provenanceIds = (file.reviewMetadata.proposalProvenance ?? []).map((p) => p.parameterId);
  expect(provenanceIds).toHaveLength(itemIds.length);
  expect([...provenanceIds].sort()).toEqual([...itemIds].sort());
}
