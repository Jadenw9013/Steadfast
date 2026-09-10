type EmailAddress = { id: string; emailAddress: string; verification?: { status: string } | null };
/** Email-based provisioning must use the verified primary identity, never array order. */
export function verifiedPrimaryEmail(addresses: EmailAddress[], primaryId: string | null | undefined): string | null {
  const primary = addresses.find(address => address.id === primaryId);
  return primary?.verification?.status === "verified" ? primary.emailAddress.toLowerCase() : null;
}
