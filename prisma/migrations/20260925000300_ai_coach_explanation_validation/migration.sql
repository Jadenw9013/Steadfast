-- T-2006/T-2030: additive, nullable column recording the bounded-prose
-- validation outcome (reason codes and a character count, never the text
-- itself) alongside the existing sanitized `validatedOutput` column on
-- AiProviderBoundaryAudit. Applied to the local test DB only; Neon is a
-- human step in the release packet.
ALTER TABLE "AiProviderBoundaryAudit" ADD COLUMN "explanationValidation" JSONB;
