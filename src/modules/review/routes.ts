import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { CreateReviewDto } from './dto';
import { createReview, listMyReviews, listRoomReviews } from './service';

export const reviewRouter = Router();

reviewRouter.use(requireAuth);

reviewRouter.post('/', async (req, res) => {
  try {
    const input = CreateReviewDto.parse(req.body);
    const review = await createReview(req.user!.sub, input);
    res.status(201).json({ review });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'ROOM_NOT_FOUND') return res.status(404).json({ message: 'Room not found' });
    if (e?.message === 'NOT_IN_ROOM') return res.status(403).json({ message: 'Room participation required' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

reviewRouter.get('/room/:roomId', async (req, res) => {
  try {
    const params = z.object({ roomId: z.string().cuid() }).parse(req.params);
    const reviews = await listRoomReviews(params.roomId);
    res.json({ reviews });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

reviewRouter.get('/me', async (req, res) => {
  try {
    const reviews = await listMyReviews(req.user!.sub);
    res.json({ reviews });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});
