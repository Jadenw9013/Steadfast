import { describe, expect, it } from "vitest";
import { isSignedFoodCatalogFile } from "@/lib/ai-coach/catalog/fdc/signed-file-guard";

/**
 * S-31 review round 1, finding 5: the ingest CLI used to write its output
 * with a bare `fs.writeFileSync`, and the README pointed `--out` at the
 * signed v1 catalog file — a re-ingest would silently downgrade a signed
 * artifact's `reviewMetadata.decision` from APPROVED to DRAFT_UNSIGNED in
 * place. `isSignedFoodCatalogFile` is the pure predicate the CLI's write
 * guard is built on.
 */
describe("ai-coach-ingest-fdc write guard", () => {
  it("recognizes a signed file and does not flag drafts, malformed input or null", () => {
    expect(isSignedFoodCatalogFile({ reviewMetadata: { decision: "APPROVED" } })).toBe(true);
    expect(isSignedFoodCatalogFile({ reviewMetadata: { decision: "DRAFT_UNSIGNED" } })).toBe(false);
    expect(isSignedFoodCatalogFile({})).toBe(false);
    expect(isSignedFoodCatalogFile(null)).toBe(false);
    expect(isSignedFoodCatalogFile("not an object")).toBe(false);
  });
});
