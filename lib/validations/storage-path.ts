/** Reject foreign objects and ambiguous/encoded paths before privileged signing. */
export function isOwnedUploadPath(path: string, ownerId: string): boolean {
  if (!ownerId || !path.startsWith(`${ownerId}/`)) return false;
  if (/[\\%?#\x00-\x1f]/.test(path)) return false;
  const segments = path.split("/");
  return segments.length >= 3 && segments.every(segment => segment !== "" && segment !== "." && segment !== "..");
}
