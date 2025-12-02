import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  createUberDeeplink,
  getRoomRideState,
  requestRoomUberRide,
  updateRideStage
} from '../controllers/ride.controller';

const router = Router();

router.post('/rides/uber/deeplink', requireAuth, createUberDeeplink);
router.get('/rides/uber/deeplink', requireAuth, createUberDeeplink);
router.get('/rooms/:id/ride-state', requireAuth, getRoomRideState);
router.post('/rooms/:id/ride/request', requireAuth, requestRoomUberRide);
router.post('/rooms/:id/ride/stage', requireAuth, updateRideStage);

export default router;