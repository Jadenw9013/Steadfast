import { NextResponse } from "next/server";

// Deprecated — messages are now a flat DM thread, no week scoping.
// Returns empty array to avoid breaking existing callers.

export async function GET() {
  return NextResponse.json({ availableWeeks: [] });
}
