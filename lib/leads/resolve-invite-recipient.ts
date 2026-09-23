import { z } from "zod";

/**
 * The single implementation of "what address, if any, would an invite go
 * to" — a dedicated address if it parses as a valid, <=100-char email,
 * else the legacy contact column if IT parses as one, else null.
 *
 * Deliberately dependency-free (zod only, no db/network) so it can be
 * imported from both `lib/leads/activate-lead.ts` (server) and a "use
 * client" confirm dialog, which chooses its warning copy from "will this
 * even have anywhere to send an invite" without duplicating the rule and
 * risking the two disagreeing (T-978 review round 1, gap 1 / N9). The
 * dialog does not gate the control on this answer — round 2's A1 found
 * that half-rule dead wrong, since a client component cannot also evaluate
 * the roster clause; the server stays the sole authority on whether
 * activation succeeds.
 *
 * T-980 replaces this body with T-961's resolveProspectEmail. T-978/this
 * fix change no resolution rule.
 */
const inviteEmailFormat = z.string().trim().toLowerCase().email().max(100);

export function resolveEmailCandidate(
  dedicated: string | null | undefined,
  legacy: string | null | undefined
): string | null {
  const d = inviteEmailFormat.safeParse(dedicated);
  if (d.success) return d.data;
  const l = inviteEmailFormat.safeParse(legacy);
  return l.success ? l.data : null;
}
