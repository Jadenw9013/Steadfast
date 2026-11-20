import { redirect, unstable_rethrow } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { accountHome } from "@/lib/auth/entry";
import { reportServerError } from "@/lib/observability/report";

export default async function AccountPage() {
  let user;
  try {
    user = await getCurrentDbUser({ allowInactive: true });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError("sf.auth.account_entry_failed", error, { route: "/account", method: "GET" });
    throw new Error("We couldn't open your account. Please try signing in again.");
  }
  redirect(accountHome(user));
}
