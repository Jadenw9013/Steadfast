import type { DraftUnsignedReviewMetadata } from "@/lib/ai-coach/artifacts/schema";

/**
 * A `DRAFT_UNSIGNED` review metadata block for tests that need one.
 *
 * S-17 signed all five checked-in artifacts, so the tests proving an unsigned
 * artifact cannot be published no longer have a real unsigned file to reach for.
 * That behaviour still has to be covered — it is what stops an unreviewed
 * artifact reaching a client — so the fixture stands in for the file the repo
 * used to carry. Kept deliberately minimal and obviously fake.
 */
export const DRAFT_UNSIGNED_METADATA: DraftUnsignedReviewMetadata = {
  decision: "DRAFT_UNSIGNED",
  preparedBy: "ENGINEERING_DRAFT_FROM_REVIEWED_SOURCE",
  preparedAt: "2026-09-27T00:00:00.000Z",
  draftRecordId: "synthetic-unsigned-draft-fixture",
  worksheetSectionIds: ["D01"],
  proposalProvenance: [
    {
      parameterId: "SYNTHETIC.UNSIGNED.FIXTURE.PARAMETER",
      sourceClaimId: "SYNTHETIC.UNSIGNED.FIXTURE.CLAIM",
      sourceId: "SYNTHETIC-UNSIGNED-FIXTURE",
      sourceUrl: "https://example.invalid/synthetic/unsigned-fixture",
      sourceLocator: "Synthetic fixture locator; not a real source.",
    },
  ],
  unsignedNotice:
    "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.",
};
