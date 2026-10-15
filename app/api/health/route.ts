import { NextResponse } from "next/server";
import { checkHealth, type HealthReport } from "@/lib/health/check";
import { EXPECTED_MIGRATIONS } from "@/lib/health/expected-migrations";
import { deployEnv, releaseId } from "@/lib/observability/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(report: HealthReport): NextResponse<HealthReport> {
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<NextResponse<HealthReport>> {
  try {
    return response(await checkHealth());
  } catch {
    return response({
      status: "degraded",
      release: releaseId(),
      env: deployEnv(),
      db: "unreachable",
      migrations: "unknown",
      migrationsApplied: 0,
      migrationsExpected: EXPECTED_MIGRATIONS,
      checkedInMs: 0,
      ts: new Date().toISOString(),
    });
  }
}
