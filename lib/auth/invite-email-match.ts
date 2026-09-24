/**
 * Invite acceptance: "does this signed-in account own the invited address?"
 *
 * T-1012. This is deliberately NOT the same question as `verifiedPrimaryEmail`,
 * which provisioning uses. Provisioning must stay primary-only: matching an email
 * there is not authorization to take over another account's Clerk identity
 * (lib/auth/roles.ts). Here we are only deciding whether a person who already
 * holds a single-use invite token is the person it was addressed to, so every
 * VERIFIED address on their account is a legitimate answer.
 *
 * Unverified addresses never match. Otherwise anyone could claim an invite by
 * adding an address they do not control.
 */

type EmailAddress = {
  id: string;
  emailAddress: string;
  verification?: { status: string } | null;
};

/** Providers that treat `user+tag@` as the same mailbox as `user@`. */
const PLUS_TAG_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "icloud.com", "me.com", "mac.com",
  "outlook.com", "hotmail.com", "live.com",
  "yahoo.com",
]);

/** Domains that are aliases for one mailbox. Apple hands out all three. */
const DOMAIN_ALIASES: Record<string, string> = {
  "googlemail.com": "gmail.com",
  "me.com": "icloud.com",
  "mac.com": "icloud.com",
};

/**
 * Canonical form for comparison only. Never store or send this — it is lossy.
 * Delivery always uses the address as written.
 */
export function normalizeEmailForMatch(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;

  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);

  domain = DOMAIN_ALIASES[domain] ?? domain;

  if (PLUS_TAG_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }

  // Gmail ignores dots in the local part. No other major provider does, so this
  // stays scoped: applying it generally would merge genuinely distinct addresses.
  if (domain === "gmail.com") local = local.replace(/\./g, "");

  return local.length ? `${local}@${domain}` : trimmed;
}

/** True when any VERIFIED address on the account is the invited address. */
export function accountOwnsEmail(
  addresses: readonly EmailAddress[] | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const target = normalizeEmailForMatch(candidate);
  if (!target) return false;
  return (addresses ?? []).some(
    (address) =>
      address?.verification?.status === "verified" &&
      normalizeEmailForMatch(address.emailAddress) === target,
  );
}

/**
 * `jad.shehadeh@icloud.com` -> `j***@icloud.com`.
 * Enough for the invitee to recognise their own address; not enough for whoever
 * holds a forwarded link to learn one they did not already know.
 */
export function maskEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  return `${local.slice(0, 1)}***${domain}`;
}
