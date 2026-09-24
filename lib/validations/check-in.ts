import { z } from "zod";

export const MAX_CHECKIN_PHOTOS = 10;
export const MAX_PHOTO_LIMIT_MESSAGE = `${MAX_CHECKIN_PHOTOS} photos maximum`;

export function validateCheckInPhotoCount(count: number): { valid: boolean; error?: string } {
  if (count <= 0) {
    return { valid: false, error: "At least one photo is required." };
  }
  if (count > MAX_CHECKIN_PHOTOS) {
    return { valid: false, error: MAX_PHOTO_LIMIT_MESSAGE };
  }
  return { valid: true };
}

export const createCheckInSchema = z.object({
  weight: z.coerce.number().positive({ message: "Weight is required" }),
  dietCompliance: z.coerce.number().int().min(1).max(10).optional().or(z.literal("")),
  energyLevel: z.coerce.number().int().min(1).max(10).optional().or(z.literal("")),
  notes: z.string().max(5000).optional(),
  photoPaths: z.array(z.string()).max(MAX_CHECKIN_PHOTOS, {
    message: MAX_PHOTO_LIMIT_MESSAGE,
  }),
  overwriteToday: z.boolean().optional(),
  templateId: z.string().optional(),
  customResponses: z.record(z.string(), z.unknown()).optional(),
});

export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;
