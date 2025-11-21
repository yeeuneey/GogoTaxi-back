import { z } from 'zod';

export const CreateReportDto = z.object({
  roomId: z.string().cuid(),
  reportedSeatNumber: z.number().int().min(1),
  message: z.string().min(5).max(5000)
});
export type CreateReportDto = z.infer<typeof CreateReportDto>;
