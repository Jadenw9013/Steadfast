/**
 * T-2059 — shared guard for the deploy-time maintenance scripts. Reads
 * DATABASE_URL from the environment only (no dotenv: the target must be
 * named explicitly on the command line), prints host/port/database and never
 * the credential, and makes `--apply` name the host AND database it is about
 * to write (`--confirm-db=<host>/<db>`; review r1 finding 3: Neon branches all
 * share the database name `neondb`).
 */
export type CliMode = {
  apply: boolean;
  /** host:port/db, for display. */
  target: string;
  /** host/db, the value --confirm-db and the overlap manifest are keyed on. */
  confirmKey: string;
  values: Record<string, string | undefined>;
};

export function parseMaintenanceArgs(
  argv: readonly string[],
  scriptName: string,
  valueFlags: readonly string[] = [],
  booleanFlags: readonly string[] = []
): CliMode {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error(`${scriptName} must not run inside a deployed process (NODE_ENV/VERCEL_ENV set). Run it from a local machine.`);
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set. Pass it inline: DATABASE_URL=... pnpm exec tsx scripts/<script>.ts");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a parseable URL.");
  }
  const database = url.pathname.replace(/^\//, "");
  const target = `${url.hostname}:${url.port || "5432"}/${database}`;
  const confirmKey = `${url.hostname}/${database}`;

  const values: Record<string, string | undefined> = {};
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--apply") continue;
    if (booleanFlags.includes(arg)) {
      values[arg] = "true";
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (eq === -1 || (flag !== "--confirm-db" && !valueFlags.includes(flag))) throw new Error(`Unknown argument: ${arg}`);
    values[flag] = arg.slice(eq + 1);
  }
  if (argv.includes("--apply") && argv.includes("--dry-run")) throw new Error("Pass either --dry-run or --apply, not both.");
  const apply = argv.includes("--apply");
  if (apply && values["--confirm-db"] !== confirmKey) {
    throw new Error(
      `--apply writes to ${target}. Confirm the host and database exactly: --apply --confirm-db=${confirmKey}` +
        (values["--confirm-db"] === undefined ? "" : ` (got --confirm-db=${values["--confirm-db"]})`)
    );
  }
  return { apply, target, confirmKey, values };
}
