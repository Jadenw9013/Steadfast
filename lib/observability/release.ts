/**
 * `VERCEL_GIT_COMMIT_SHA` and `VERCEL_ENV` are injected by Vercel at build/run
 * time — never set by a developer and never added to `.env.example`. See
 * `ARCHITECTURE.md` § Observability for the full table.
 *
 * Both values are memoized at module scope per the frozen contract: they
 * cannot change for the lifetime of a running process.
 */

let cachedReleaseId: string | undefined;

/** 7-char commit sha, or `"local"` when `VERCEL_GIT_COMMIT_SHA` is unset. */
export function releaseId(): string {
  if (cachedReleaseId === undefined) {
    const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
    cachedReleaseId = sha.slice(0, 7) || "local";
  }
  return cachedReleaseId;
}

type DeployEnv = "production" | "preview" | "development";

let cachedDeployEnv: DeployEnv | undefined;

/** `"development"` when `VERCEL_ENV` is unset or not one of the two known
 *  non-development values. */
export function deployEnv(): DeployEnv {
  if (cachedDeployEnv === undefined) {
    const raw = process.env.VERCEL_ENV;
    cachedDeployEnv = raw === "production" || raw === "preview" ? raw : "development";
  }
  return cachedDeployEnv;
}
