import { describe, it, expect, vi } from "vitest";

// Must set DATABASE_URL before db.ts is imported — the validation runs at module load time.
// vi.hoisted runs before ESM module evaluation.
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});

vi.mock("@/app/generated/prisma/client", () => ({
  PrismaClient: class MockPrismaClient { },
  Prisma: {
    PrismaClientKnownRequestError: class MockPrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
        this.name = "PrismaClientKnownRequestError";
      }
    },
  },
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg { },
}));

import { prismaErrorMessage } from "@/lib/db";

import { Prisma } from "@/app/generated/prisma/client";

describe("prismaErrorMessage", () => {
  it("detects P2021 table-missing error", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Table does not exist", { code: "P2021", clientVersion: "1.0.0" });
    const result = prismaErrorMessage(error);
    expect(result.status).toBe(503);
    expect(result.message).toContain("migration missing");
  });

  it("detects P2002 unique constraint failed error", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "1.0.0" });
    const result = prismaErrorMessage(error);
    expect(result.status).toBe(409);
    expect(result.message).toBe("Unique constraint failed");
  });

  it("returns 500 for generic Error", () => {
    const result = prismaErrorMessage(new Error("Something broke"));
    expect(result.status).toBe(500);
    expect(result.message).toBe("Internal server error");
  });

  it("returns generic message for non-Error", () => {
    const result = prismaErrorMessage("random string");
    expect(result.status).toBe(500);
    expect(result.message).toBe("Internal server error");
  });

  it("returns 500 for other Prisma error codes", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Other error", { code: "P2025", clientVersion: "1.0.0" });
    const result = prismaErrorMessage(error);
    expect(result.status).toBe(500);
    expect(result.message).toBe("Database error");
  });
});
