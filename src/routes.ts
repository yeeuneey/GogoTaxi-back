import { Router } from 'express';
import { authRouter } from './modules/auth/routes';
import { requireAuth } from './middlewares/auth';
import { walletRouter } from './modules/wallet/routes';
import { settlementRouter } from './modules/settlement/routes';
import { paymentsRouter } from './modules/payments/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { reviewRouter } from './modules/review/routes';
import { reportRouter } from './modules/report/routes';

export const router = Router();

// 상태 확인
router.get('/', (_req, res) => res.json({ message: 'GogoTaxi backend up' }));

// 인증 관련
router.use('/auth', authRouter);

// 지갑 / 결제
router.use('/wallet', walletRouter);
router.use('/payments', paymentsRouter);

// 정산
router.use('/settlements', settlementRouter);

// 알림
router.use('/notifications', notificationsRouter);

// 후기 / 신고
router.use('/reviews', reviewRouter);
router.use('/reports', reportRouter);

// 보호 라우트 예시 (토큰 필요)
router.get('/me', requireAuth, (req, res) => {
  res.json({ me: req.user });
});

module.exports = { router };
