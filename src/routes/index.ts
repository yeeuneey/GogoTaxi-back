import { Router } from 'express';
import { authRouter } from '../modules/auth/routes';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../lib/prisma';
import roomRouter from './room.routes';
import rideRouter from './ride.routes';
import { paymentsRouter } from '../modules/payments/routes';
import { walletRouter } from '../modules/wallet/routes';
import { getProfile, updateProfile, changePassword } from '../modules/auth/service';
import { UpdateProfileDto, ChangePasswordDto } from '../modules/auth/dto';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

router.use('/auth', authRouter);
router.use('/payments', paymentsRouter);
router.use('/wallet', walletRouter);
router.use(roomRouter);
router.use(rideRouter);

router.get('/me', requireAuth, async (req: any, res) => {
  try {
    const me = await getProfile(req.userId);
    res.json({ me });
  } catch (e: any) {
    if (e?.message === 'USER_NOT_FOUND')
      return res.status(404).json({ message: 'User not found' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

router.patch('/me', requireAuth, async (req: any, res) => {
  try {
    const input = UpdateProfileDto.parse(req.body);
    const me = await updateProfile(req.userId, input);
    res.json({ me });
  } catch (e: any) {
    if (e?.name === 'ZodError')
      return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'USER_NOT_FOUND')
      return res.status(404).json({ message: 'User not found' });

    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

router.patch('/me/password', requireAuth, async (req: any, res) => {
  try {
    const input = ChangePasswordDto.parse(req.body);
    await changePassword(req.userId, input);
    res.json({ success: true });
  } catch (e: any) {
    if (e?.name === 'ZodError')
      return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'INVALID_CURRENT_PASSWORD')
      return res.status(401).json({ message: 'Current password is incorrect' });
    if (e?.message === 'PASSWORD_NOT_SET')
      return res.status(400).json({ message: 'Password not set for this account' });

    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

router.get('/notifications', requireAuth, async (_req, res) => {
  try {
    const notifications = await prisma.notice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    return res.json({ notifications });
  } catch (error) {
    console.error('notifications error', error);
    return res.status(500).json({ message: 'Failed to load notifications' });
  }
});
