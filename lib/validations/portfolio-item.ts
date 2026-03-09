import { z } from "zod";

export const createPortfolioItemSchema = z.object({
    title: z.string().min(2, "Caption must be at least 2 characters").max(150),
    result: z.string().max(200).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    category: z.string().max(50).optional().nullable(),
    mediaPath: z.string().max(500).optional().nullable(),
    mediaType: z.enum(["image", "video"]).optional().nullable(),
});

export const updatePortfolioItemSchema = createPortfolioItemSchema.extend({
    id: z.string().cuid(),
});

export const reorderPortfolioItemsSchema = z.object({
    itemIds: z.array(z.string().cuid()),
});

export type CreatePortfolioItemData = z.infer<typeof createPortfolioItemSchema>;
export type UpdatePortfolioItemData = z.infer<typeof updatePortfolioItemSchema>;
