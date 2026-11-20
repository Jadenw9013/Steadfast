import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AccountEntry } from "@/components/auth/account-entry";
import { accountReturnTo, authEntryUrl, type AuthSearchParams } from "@/lib/auth/entry";

export default async function SignUpPage({ params, searchParams }: {
  params: Promise<{ "sign-up"?: string[] }>;
  searchParams: Promise<AuthSearchParams>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const returnTo = accountReturnTo(query.redirect_url, process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL);
  const { userId } = await auth();
  if (userId) redirect(returnTo);
  if (!route["sign-up"]?.length && !query.__clerk_ticket && !query.__clerk_status) redirect(authEntryUrl(returnTo));
  return <AccountEntry returnTo={returnTo} legacySignUp />;
}
