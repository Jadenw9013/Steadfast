import { describe, it, expect } from "vitest";
import {
  questionSchema,
  createTemplateSchema,
  updateTemplateSchema,
} from "@/lib/validations/check-in-template";

// ── questionSchema ──────────────────────────────────────────────────────────

describe("questionSchema", () => {
  const validBase = {
    id: "q1",
    label: "How are you feeling?",
    sortOrder: 0,
    required: false,
  };

  describe("shortText type", () => {
    it("accepts valid shortText question", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "shortText" });
      expect(result.success).toBe(true);
    });
  });

  describe("longText type", () => {
    it("accepts valid longText question", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "longText" });
      expect(result.success).toBe(true);
    });
  });

  describe("boolean type", () => {
    it("accepts valid boolean question", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "boolean" });
      expect(result.success).toBe(true);
    });
  });

  describe("number type", () => {
    it("accepts valid number question with config", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "number",
        config: { min: 0, max: 500, step: 0.1, unit: "lbs" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts number question with empty config", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "number", config: {} });
      expect(result.success).toBe(true);
    });

    it("rejects number config with negative step", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "number",
        config: { step: -1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("scale type", () => {
    it("accepts valid scale question", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { min: 1, max: 10, step: 1 },
      });
      expect(result.success).toBe(true);
    });

    it("accepts scale with labels", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { min: 1, max: 10, step: 1, minLabel: "Low", maxLabel: "High" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects scale where min >= max", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { min: 10, max: 10, step: 1 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects scale where min > max", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { min: 10, max: 5, step: 1 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects scale with missing min", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { max: 10, step: 1 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects scale with missing max", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { min: 1, step: 1 },
      });
      expect(result.success).toBe(false);
    });

    it("defaults step to 1 when omitted", () => {
      const result = questionSchema.safeParse({
        ...validBase,
        type: "scale",
        config: { min: 0, max: 10 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("common validations", () => {
    it("rejects empty id", () => {
      const result = questionSchema.safeParse({ ...validBase, id: "", type: "shortText" });
      expect(result.success).toBe(false);
    });

    it("rejects empty label", () => {
      const result = questionSchema.safeParse({ ...validBase, label: "", type: "shortText" });
      expect(result.success).toBe(false);
    });

    it("rejects label over 200 chars", () => {
      const result = questionSchema.safeParse({ ...validBase, label: "x".repeat(201), type: "shortText" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid question type", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "emoji" });
      expect(result.success).toBe(false);
    });

    it("rejects negative sortOrder", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "shortText", sortOrder: -1 });
      expect(result.success).toBe(false);
    });

    it("defaults required to false", () => {
      const { required: _, ...base } = validBase;
      const result = questionSchema.safeParse({ ...base, type: "shortText" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.required).toBe(false);
    });

    it("defaults config to empty object", () => {
      const result = questionSchema.safeParse({ ...validBase, type: "shortText" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.config).toEqual({});
    });
  });
});

// ── createTemplateSchema ────────────────────────────────────────────────────

describe("createTemplateSchema", () => {
  const validQuestion = {
    id: "q1",
    type: "shortText" as const,
    label: "How are you?",
    sortOrder: 0,
  };

  it("accepts valid template with one question", () => {
    const result = createTemplateSchema.safeParse({
      name: "Weekly Check-in",
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createTemplateSchema.safeParse({
      name: "",
      questions: [validQuestion],
    });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = createTemplateSchema.safeParse({
      name: "x".repeat(101),
      questions: [validQuestion],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty questions array", () => {
    const result = createTemplateSchema.safeParse({
      name: "Test",
      questions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 30 questions", () => {
    const questions = Array.from({ length: 31 }, (_, i) => ({
      ...validQuestion,
      id: `q${i}`,
      sortOrder: i,
    }));
    const result = createTemplateSchema.safeParse({
      name: "Test",
      questions,
    });
    expect(result.success).toBe(false);
  });

  it("accepts up to 30 questions", () => {
    const questions = Array.from({ length: 30 }, (_, i) => ({
      ...validQuestion,
      id: `q${i}`,
      sortOrder: i,
    }));
    const result = createTemplateSchema.safeParse({
      name: "Test",
      questions,
    });
    expect(result.success).toBe(true);
  });

  it("defaults isDefault to false", () => {
    const result = createTemplateSchema.safeParse({
      name: "Test",
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isDefault).toBe(false);
  });
});

// ── updateTemplateSchema ────────────────────────────────────────────────────

describe("updateTemplateSchema", () => {
  it("accepts update with only templateId", () => {
    const result = updateTemplateSchema.safeParse({ templateId: "template-1" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with name", () => {
    const result = updateTemplateSchema.safeParse({
      templateId: "template-1",
      name: "Updated Name",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing templateId", () => {
    const result = updateTemplateSchema.safeParse({ name: "Test" });
    expect(result.success).toBe(false);
  });

  it("rejects empty templateId", () => {
    const result = updateTemplateSchema.safeParse({ templateId: "" });
    expect(result.success).toBe(false);
  });
});
