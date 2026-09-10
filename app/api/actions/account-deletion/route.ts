import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { requestAccountDeletion } from "@/app/actions/account-deletion";

export async function POST(req: NextRequest) {
  try { await getCurrentDbUser({ allowInactive: true }); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    const result = await requestAccountDeletion(await req.json());
    return NextResponse.json(result);
  } catch (error) {
    console.error("[account-deletion]", error);
    return NextResponse.json({ error: "The request could not be completed. Check your confirmation and try again. If deletion has already started it cannot be cancelled." }, { status: 422 });
  }
}
