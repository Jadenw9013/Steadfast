import { PrismaClient, Prisma } from "@/app/generated/prisma/client";
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

  // Pass PoolConfig to PrismaPg — it creates and manages its own Pool internally.
  // This gives proper type parsing for Json columns vs passing connectionString directly.
  const adapter = new PrismaPg({
    connectionString,
    ssl: connectionString.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
  });
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
 * Detect Prisma errors and return a clear message.
 * Use in route handler catch blocks to surface migration or database issues.
 */
export function prismaErrorMessage(error: unknown): { message: string; status: number } {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return { message: "Unique constraint failed", status: 409 };
      case "P2021":
        return {
          message: "DB migration missing — the required table does not exist. Run: npx prisma migrate deploy",
          status: 503,
        };
      default:
        return { message: "Database error", status: 500 };
    }
  }

  return {
    message: "Internal server error",
    status: 500,
  };
}
