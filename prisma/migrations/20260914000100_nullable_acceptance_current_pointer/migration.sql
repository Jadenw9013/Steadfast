-- A historical acceptance can be replayed after the current pointer is cleared.
-- Preserve that absence in the audit receipt instead of inventing an active ID.
ALTER TABLE "AiPlanAcceptanceReceipt"
  ALTER COLUMN "activeVersionIdAtReceiptTime" DROP NOT NULL;
