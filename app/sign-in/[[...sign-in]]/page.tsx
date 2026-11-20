import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AccountEntry } from "@/components/auth/account-entry";
import { accountReturnTo, type AuthSearchParams } from "@/lib/auth/entry";

export default async function SignInPage({ searchParams }: { searchParams: Promise<AuthSearchParams> }) {
  const params = await searchParams;
  const returnTo = accountReturnTo(params.redirect_url, process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL);
  const { userId } = await auth();
  if (userId) redirect(returnTo);
  return <AccountEntry returnTo={returnTo} />;
}
