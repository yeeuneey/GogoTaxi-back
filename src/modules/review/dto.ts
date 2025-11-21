import { z } from 'zod';

export const CreateReviewDto = z.object({
  roomId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional()
});
export type CreateReviewDto = z.infer<typeof CreateReviewDto>;
