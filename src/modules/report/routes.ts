import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { CreateReportDto } from './dto';
import { createReport, listMyReports, listRoomReports } from './service';

export const reportRouter = Router();

reportRouter.use(requireAuth);

reportRouter.post('/', async (req, res) => {
  try {
    const input = CreateReportDto.parse(req.body);
    const report = await createReport(req.user!.sub, input);
    res.status(201).json({ report });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'ROOM_NOT_FOUND') return res.status(404).json({ message: 'Room not found' });
    if (e?.message === 'NOT_IN_ROOM') return res.status(403).json({ message: 'Room participation required' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

reportRouter.get('/room/:roomId', async (req, res) => {
  try {
    const params = z.object({ roomId: z.string().cuid() }).parse(req.params);
    const reports = await listRoomReports(params.roomId);
    res.json({ reports });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

reportRouter.get('/me', async (req, res) => {
  try {
    const reports = await listMyReports(req.user!.sub);
    res.json({ reports });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});
