import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { finalizeRoomSettlement, holdEstimatedFare } from './service';
import { loadRoomOrThrow, broadcastRoom } from '../../controllers/room.controller';
import { emitRoomsRefresh } from '../../lib/socket';

export const settlementRouter = Router();
settlementRouter.use(requireAuth);

settlementRouter.post('/rooms/:roomId/hold', async (req, res) => {
  try {
    const roomId = z.string().cuid().parse(req.params.roomId);
    const result = await holdEstimatedFare(roomId);
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'ROOM_NOT_FOUND') return res.status(404).json({ message: 'Room not found' });
    if (e?.message === 'ESTIMATED_FARE_MISSING') return res.status(409).json({ message: 'Estimated fare required' });
    if (e?.message === 'INSUFFICIENT_BALANCE') return res.status(402).json({ message: 'Insufficient balance' });
    console.error(e);
    res.status(500).json({ message: e?.message ?? 'Internal error' });
  }
});

settlementRouter.post('/rooms/:roomId/finalize', async (req, res) => {
  try {
    const roomId = z.string().cuid().parse(req.params.roomId);
    const body = z.object({ actualFare: z.number().int().positive() }).parse(req.body);
    const result = await finalizeRoomSettlement(roomId, body.actualFare);
    const room = await loadRoomOrThrow(roomId);
    broadcastRoom(room, (req as any).user?.sub);
    emitRoomsRefresh({ roomId, reason: 'settled' });
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'ROOM_NOT_FOUND') return res.status(404).json({ message: 'Room not found' });
    if (e?.message === 'ESTIMATED_FARE_MISSING') return res.status(409).json({ message: 'Estimated fare required' });
    console.error(e);
    res.status(500).json({ message: e?.message ?? 'Internal error' });
  }
});
