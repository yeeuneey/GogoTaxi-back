import { Router } from 'express';
import { authRouter } from '../modules/auth/routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

router.use('/auth', authRouter);

export default router;
