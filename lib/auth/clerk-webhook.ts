// Pure role-resolution logic for the Clerk webhook handler
// (app/api/webhooks/clerk/route.ts), split out so the "never silently
// demote a coach" rule can be unit tested without mocking Clerk/Prisma.

export function isCoachMetadata(publicMetadataRole: unknown): boolean {
  return typeof publicMetadataRole === "string" && publicMetadataRole.toUpperCase() === "COACH";
}

/**
 * Fields to write on user.created. Fresh signup — no existing DB role state
 * to protect, so Clerk metadata is the full source of truth.
 */
export function resolveRoleOnCreate(publicMetadataRole: unknown): {
  activeRole: "COACH" | "CLIENT";
  isCoach: boolean;
  isClient: boolean;
} {
  const coach = isCoachMetadata(publicMetadataRole);
  return { activeRole: coach ? "COACH" : "CLIENT", isCoach: coach, isClient: !coach };
}

/**
 * Fields to write on user.updated. This event fires for any profile change
 * (name, photo, session activity, etc.), not just role changes. Coaches who
 * got isCoach via the in-app "Become a Coach" flow never have Clerk metadata
 * set to "coach", so treating metadata as authoritative here would silently
 * strip coach access on the next incidental webhook.
 *
 * Rule: only ever *promote* — set isCoach:true when metadata says coach and
 * the user isn't already one. Never demote, and never touch activeRole
 * (that's controlled by the in-app role switcher, not Clerk sync).
 */
export function resolveRoleOnUpdate(
  publicMetadataRole: unknown,
  existing: { isCoach: boolean } | null
): { isCoach?: true } {
  const shouldPromote = isCoachMetadata(publicMetadataRole) && existing?.isCoach !== true;
  return shouldPromote ? { isCoach: true } : {};
}
