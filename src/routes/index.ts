import { Router } from 'express';
import { z } from 'zod';
import { authRouter } from '../modules/auth/routes';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../lib/prisma';
import roomRouter from './room.routes';
import rideRouter from './ride.routes';
import { paymentsRouter } from '../modules/payments/routes';
import { walletRouter } from '../modules/wallet/routes';
import { getProfile, updateProfile, changePassword } from '../modules/auth/service';
import { UpdateProfileDto, ChangePasswordDto } from '../modules/auth/dto';
import { settlementRouter } from '../modules/settlement/routes';
import { notificationsRouter } from '../modules/notifications/routes';
import { reviewRouter } from '../modules/review/routes';
import { reportRouter } from '../modules/report/routes';
import { rideHistoryRouter } from '../modules/rideHistory/routes';
import { analyzeReceiptImage } from '../modules/rideHistory/receiptService';
import { holdEstimatedFare, finalizeRoomSettlement } from '../modules/settlement/service';
import { loadRoomOrThrow, broadcastRoom } from '../controllers/room.controller';
import { emitRoomsRefresh } from '../lib/socket';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

router.use('/auth', authRouter);
router.use('/payments', paymentsRouter);
router.use('/wallet', walletRouter);
router.use('/settlements', settlementRouter);
router.use(roomRouter);
router.use(rideRouter);
router.use('/rides', rideHistoryRouter);
router.use('/notifications', notificationsRouter);
router.use('/reviews', reviewRouter);
router.use('/reports', reportRouter);

router.post('/receipts/analyze', requireAuth, async (req, res) => {
  try {
    const input = z
      .object({
        imageBase64: z.string().min(20, 'imageBase64 is required'),
        mimeType: z.string().optional(),
        prompt: z.string().optional(),
        roomId: z.string().cuid().optional(),
        action: z.enum(['hold', 'finalize']).optional()
      })
      .refine((val) => !val.action || !!val.roomId, {
        message: 'roomId is required when action is provided',
        path: ['roomId']
      })
      .parse(req.body);
    const analysis = await analyzeReceiptImage(input);

    let settlement: any = null;
    if (input.action && input.roomId) {
      const amount = normalizeReceiptAmount(analysis);
      const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true, creatorId: true } });
      if (!room) {
        return res.status(404).json({ message: 'Room not found' });
      }
      const authUserId = (req as any)?.user?.sub;
      if (room.creatorId !== authUserId) {
        return res.status(403).json({ message: 'Only the host can manage settlement for this room' });
      }
      if (input.action === 'hold') {
        await prisma.room.update({ where: { id: room.id }, data: { estimatedFare: amount } });
        settlement = { action: 'hold', ...(await holdEstimatedFare(room.id)) };
      } else {
        settlement = { action: 'finalize', ...(await finalizeRoomSettlement(room.id, amount)) };
        const updatedRoom = await loadRoomOrThrow(room.id);
        broadcastRoom(updatedRoom, authUserId);
        emitRoomsRefresh({ roomId: room.id, reason: 'settled' });
      }
    }

    res.json({ analysis, settlement });
  } catch (e: any) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    }
    if (e?.message === 'INVALID_IMAGE_BASE64' || e?.message === 'IMAGE_BASE64_REQUIRED') {
      return res.status(400).json({ message: 'Invalid or unsupported receipt image payload' });
    }
    if (e?.message === 'RECEIPT_TOTAL_MISSING') {
      return res.status(422).json({ message: 'Receipt does not contain a recognizable total amount' });
    }
    if (e?.message === 'RECEIPT_NOT_RECOGNIZED') {
      return res.status(422).json({ message: 'Unable to recognize a receipt in the uploaded image' });
    }
    if (e?.message === 'UNSUPPORTED_RECEIPT_CURRENCY') {
      return res.status(422).json({ message: '지원되지 않는 통화입니다. KRW 영수증만 처리할 수 있어요.' });
    }
    if (e?.message === 'ROOM_NOT_FOUND') {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (e?.message === 'ESTIMATED_FARE_MISSING') {
      return res.status(409).json({ message: 'Estimated fare required' });
    }
    if (e?.message === 'INSUFFICIENT_BALANCE') {
      return res.status(402).json({ message: 'Insufficient balance' });
    }
    if (
      typeof e?.status === 'number' &&
      e.status >= 400 &&
      e.status < 500 &&
      typeof e?.message === 'string' &&
      e.message.includes('GEMINI_REQUEST_FAILED')
    ) {
      return res
        .status(400)
        .json({ message: e?.geminiMessage || 'Gemini에서 이미지를 처리하지 못했습니다. 다른 형식으로 시도해 주세요.' });
    }
    if (e?.message === 'GEMINI_API_KEY_NOT_CONFIGURED') {
      return res.status(500).json({ message: 'Gemini API key is not configured.' });
    }
    console.error('receipt analyze error', e);
    const isGeminiUnavailable =
      typeof e?.message === 'string' &&
      (e.message.includes('GEMINI_FETCH_FAILED') || e.message.includes('GEMINI_REQUEST_FAILED'));
    res.status(isGeminiUnavailable ? 502 : 500).json({
      message: isGeminiUnavailable
        ? 'Gemini Vision 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : e?.message || 'Failed to analyze receipt'
    });
  }
});


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

function normalizeReceiptAmount(analysis: Awaited<ReturnType<typeof analyzeReceiptImage>>): number {
  const amount =
    typeof analysis.totalAmount === 'number' && Number.isFinite(analysis.totalAmount)
      ? Math.round(Math.abs(analysis.totalAmount))
      : null;
  if (!amount || amount <= 0) {
    throw new Error('RECEIPT_TOTAL_MISSING');
  }
  const currency = analysis.currency?.trim().toUpperCase();
  if (currency && currency !== 'KRW') {
    throw new Error('UNSUPPORTED_RECEIPT_CURRENCY');
  }
  return amount;
}
