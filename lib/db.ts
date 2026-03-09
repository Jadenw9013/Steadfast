import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Neon connection string."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/** Lazy-initialized Prisma client — throws on first use if DATABASE_URL is missing. */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop);
  },
});

/**
 * Detect Prisma P2021 "table does not exist" errors and return a clear message.
 * Use in route handler catch blocks to surface migration issues.
 */
export function prismaErrorMessage(error: unknown): { message: string; status: number } {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "P2021"
  ) {
    return {
      message: "DB migration missing — the required table does not exist. Run: npx prisma migrate deploy",
      status: 503,
    };
  }
  return {
    message: error instanceof Error ? error.message : "Internal server error",
    status: 500,
  };
}
