"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const routes_1 = require("./modules/auth/routes");
const auth_1 = require("./middlewares/auth");
const routes_2 = require("./modules/wallet/routes");
const routes_3 = require("./modules/settlement/routes");
const routes_4 = require("./modules/payments/routes");
const routes_5 = require("./modules/notifications/routes");
const routes_6 = require("./modules/review/routes");
const routes_7 = require("./modules/report/routes");
exports.router = (0, express_1.Router)();
// 상태 확인
exports.router.get('/', (_req, res) => res.json({ message: 'GogoTaxi backend up' }));
// 인증 관련
exports.router.use('/auth', routes_1.authRouter);
// 지갑 / 결제
exports.router.use('/wallet', routes_2.walletRouter);
exports.router.use('/payments', routes_4.paymentsRouter);
// 정산
exports.router.use('/settlements', routes_3.settlementRouter);
// 알림
exports.router.use('/notifications', routes_5.notificationsRouter);
// 후기 / 신고
exports.router.use('/reviews', routes_6.reviewRouter);
exports.router.use('/reports', routes_7.reportRouter);
// 보호 라우트 예시 (토큰 필요)
exports.router.get('/me', auth_1.requireAuth, (req, res) => {
    res.json({ me: req.user });
});
