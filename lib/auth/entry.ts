export type AuthSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_ACCOUNT_DESTINATION = "/account";

export function accountReturnTo(value: unknown, appUrl?: string): string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_ACCOUNT_DESTINATION;
  }
  try {
    const origin = new URL(appUrl || "https://steadfast-coaching.com").origin;
    if (!value.startsWith("/") && new URL(value).origin !== origin) return DEFAULT_ACCOUNT_DESTINATION;
    if (value.startsWith("//")) return DEFAULT_ACCOUNT_DESTINATION;
    const target = new URL(value, origin);
    if (target.origin !== origin) return DEFAULT_ACCOUNT_DESTINATION;
    const path = decodeURIComponent(decodeURIComponent(target.pathname));
    if (/[\\\u0000-\u001f\u007f]/.test(path) || path.includes("//") || path !== target.pathname) {
      return DEFAULT_ACCOUNT_DESTINATION;
    }
    if (path === "/") return DEFAULT_ACCOUNT_DESTINATION;
    if (!/^(?:\/account|\/account-deletion-pending|\/client(?:\/[^?#]*)?|\/coach(?:\/[^?#]*)?|\/onboarding(?:\/(?:intake|sign)\/[^/]+)?|\/invite\/(?:team\/)?[^/]+)$/.test(path)) {
      return DEFAULT_ACCOUNT_DESTINATION;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return DEFAULT_ACCOUNT_DESTINATION;
  }
}

export function authEntryUrl(returnTo = DEFAULT_ACCOUNT_DESTINATION): string {
  return `/sign-in?redirect_url=${encodeURIComponent(accountReturnTo(returnTo))}`;
}

export function accountHome(user: { activeRole: string; isDeactivated: boolean }): string {
  if (user.isDeactivated) return "/account-deletion-pending";
  return user.activeRole === "COACH" ? "/coach/dashboard" : "/client";
}
