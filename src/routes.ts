import { Router } from 'express';
import { authRouter } from './modules/auth/routes';
import { requireAuth } from './middlewares/auth';

export const router = Router();

// 상태 확인
router.get('/', (_req, res) => res.json({ message: 'GogoTaxi backend up' }));

// 인증 관련
router.use('/auth', authRouter);

// 보호 라우트 예시 (토큰 필요)
router.get('/me', requireAuth, (req, res) => {
  res.json({ me: req.user });
});