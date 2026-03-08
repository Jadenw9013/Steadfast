import { z } from "zod";

export const createPortfolioItemSchema = z.object({
    title: z.string().min(2, "Title must be at least 2 characters").max(100),
    result: z.string().max(200).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    category: z.string().max(50).optional().nullable(),
});

export const updatePortfolioItemSchema = createPortfolioItemSchema.extend({
    id: z.string().cuid(),
});

export const reorderPortfolioItemsSchema = z.object({
    itemIds: z.array(z.string().cuid()),
});

export type CreatePortfolioItemData = z.infer<typeof createPortfolioItemSchema>;
export type UpdatePortfolioItemData = z.infer<typeof updatePortfolioItemSchema>;
