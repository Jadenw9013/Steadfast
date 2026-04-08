import { describe, it, expect } from "vitest";
import {
  parsedBlockSchema,
  parsedDaySchema,
  parsedWorkoutProgramSchema,
  validateWorkoutUploadFile,
} from "@/lib/validations/workout-import";

// ── parsedBlockSchema ───────────────────────────────────────────────────────

describe("parsedBlockSchema", () => {
  it("accepts valid block", () => {
    const result = parsedBlockSchema.safeParse({
      type: "EXERCISE",
      title: "Bench Press",
      content: "4x8 @ 185lbs",
    });
    expect(result.success).toBe(true);
  });

  it("defaults type to EXERCISE", () => {
    const result = parsedBlockSchema.safeParse({ title: "Squats", content: "5x5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("EXERCISE");
  });

  it("defaults title and content to empty strings", () => {
    const result = parsedBlockSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("");
      expect(result.data.content).toBe("");
    }
  });

  it("accepts all valid block types", () => {
    const types = ["EXERCISE", "ACTIVATION", "INSTRUCTION", "SUPERSET", "CARDIO", "OPTIONAL"];
    for (const type of types) {
      const result = parsedBlockSchema.safeParse({ type });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid block type", () => {
    const result = parsedBlockSchema.safeParse({ type: "STRETCHING" });
    expect(result.success).toBe(false);
  });
});

// ── parsedDaySchema ─────────────────────────────────────────────────────────

describe("parsedDaySchema", () => {
  it("accepts valid day", () => {
    const result = parsedDaySchema.safeParse({
      dayName: "Push Day",
      blocks: [{ type: "EXERCISE", title: "Bench", content: "4x8" }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults dayName to empty string", () => {
    const result = parsedDaySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dayName).toBe("");
  });

  it("defaults blocks to empty array", () => {
    const result = parsedDaySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.blocks).toEqual([]);
  });
});

// ── parsedWorkoutProgramSchema ──────────────────────────────────────────────

describe("parsedWorkoutProgramSchema", () => {
  const validDay = {
    dayName: "Leg Day",
    blocks: [{ type: "EXERCISE" as const, title: "Squat", content: "5x5" }],
  };

  it("accepts valid program", () => {
    const result = parsedWorkoutProgramSchema.safeParse({
      name: "PPL Split",
      days: [validDay],
    });
    expect(result.success).toBe(true);
  });

  it("defaults name to 'Imported Workout Plan'", () => {
    const result = parsedWorkoutProgramSchema.safeParse({ days: [validDay] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Imported Workout Plan");
  });

  it("defaults notes to empty string", () => {
    const result = parsedWorkoutProgramSchema.safeParse({ days: [validDay] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notes).toBe("");
  });

  it("requires at least one day", () => {
    const result = parsedWorkoutProgramSchema.safeParse({ name: "Test", days: [] });
    expect(result.success).toBe(false);
  });

  it("accepts program with multiple days", () => {
    const result = parsedWorkoutProgramSchema.safeParse({
      name: "Full Program",
      days: [
        { dayName: "Push", blocks: [{ type: "EXERCISE", title: "Bench", content: "4x8" }] },
        { dayName: "Pull", blocks: [{ type: "EXERCISE", title: "Rows", content: "4x10" }] },
        { dayName: "Legs", blocks: [{ type: "EXERCISE", title: "Squat", content: "5x5" }] },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.days).toHaveLength(3);
  });
});

// ── validateWorkoutUploadFile ───────────────────────────────────────────────

describe("validateWorkoutUploadFile", () => {
  it("accepts PNG", () => {
    expect(validateWorkoutUploadFile("image/png").valid).toBe(true);
  });

  it("accepts JPEG", () => {
    expect(validateWorkoutUploadFile("image/jpeg").valid).toBe(true);
  });

  it("accepts WebP", () => {
    expect(validateWorkoutUploadFile("image/webp").valid).toBe(true);
  });

  it("accepts PDF", () => {
    expect(validateWorkoutUploadFile("application/pdf").valid).toBe(true);
  });

  it("rejects unsupported types", () => {
    const result = validateWorkoutUploadFile("text/plain");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unsupported file type");
  });

  it("rejects video files", () => {
    const result = validateWorkoutUploadFile("video/mp4");
    expect(result.valid).toBe(false);
  });

  it("rejects files over 10MB", () => {
    const result = validateWorkoutUploadFile("image/png", 11 * 1024 * 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("accepts files under 10MB", () => {
    expect(validateWorkoutUploadFile("image/png", 5 * 1024 * 1024).valid).toBe(true);
  });

  it("accepts files at exactly 10MB", () => {
    expect(validateWorkoutUploadFile("image/png", 10 * 1024 * 1024).valid).toBe(true);
  });

  it("accepts when size is not provided", () => {
    expect(validateWorkoutUploadFile("image/png").valid).toBe(true);
  });
});
