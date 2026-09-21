/**
 * Number of timestamped migration directories shipped with this build.
 * Keep this in the same commit as any migration; a unit test compares it to
 * prisma/migrations so drift fails in CI instead of degrading production.
 */
export const EXPECTED_MIGRATIONS = 66;
