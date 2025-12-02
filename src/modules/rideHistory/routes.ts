import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { listRideHistory } from './service';

export const rideHistoryRouter = Router();

rideHistoryRouter.use(requireAuth);

rideHistoryRouter.get('/history', async (req, res) => {
  try {
    const histories = await listRideHistory(req.user!.sub);
    res.json({ histories });
  } catch (e) {
    console.error('ride history error', e);
    res.status(500).json({ message: 'Failed to load ride history' });
  }
});
