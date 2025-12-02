"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
// 인증
const routes_1 = require("./modules/auth/routes");
const auth_1 = require("./middlewares/auth");
const prisma_1 = require("./lib/prisma");
const service_1 = require("./modules/auth/service");
const dto_1 = require("./modules/auth/dto");
// 지갑 / 결제 / 정산
const routes_2 = require("./modules/wallet/routes");
const routes_3 = require("./modules/settlement/routes");
const routes_4 = require("./modules/payments/routes");
const room_routes_1 = __importDefault(require("./routes/room.routes"));
// 알림
const routes_5 = require("./modules/notifications/routes");
// 후기 / 신고
const routes_6 = require("./modules/review/routes");
const routes_7 = require("./modules/report/routes");
exports.router = (0, express_1.Router)();
/* ============================================
   상태 확인
=============================================== */
exports.router.get('/', (_req, res) => res.json({ message: 'GogoTaxi backend up' }));
/* ============================================
   인증 관련
=============================================== */
exports.router.use('/auth', routes_1.authRouter);
/* ============================================
   지갑 / 결제 / 정산
=============================================== */
exports.router.use('/wallet', routes_2.walletRouter);
exports.router.use('/payments', routes_4.paymentsRouter);
exports.router.use('/settlements', routes_3.settlementRouter);
exports.router.use(room_routes_1.default);
/* ============================================
   알림
=============================================== */
exports.router.use('/notifications', routes_5.notificationsRouter);
/* ============================================
   후기 / 신고
=============================================== */
exports.router.use('/reviews', routes_6.reviewRouter);
exports.router.use('/reports', routes_7.reportRouter);
/* ============================================
   보호 API (로그인 필요)
=============================================== */
exports.router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const me = await (0, service_1.getProfile)(req.userId);
        res.json({ me });
    }
    catch (e) {
        if (e?.message === 'USER_NOT_FOUND')
            return res.status(404).json({ message: 'User not found' });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.router.patch('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const input = dto_1.UpdateProfileDto.parse(req.body);
        const me = await (0, service_1.updateProfile)(req.userId, input);
        res.json({ me });
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        if (e?.message === 'USER_NOT_FOUND')
            return res.status(404).json({ message: 'User not found' });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.router.patch('/me/password', auth_1.requireAuth, async (req, res) => {
    try {
        const input = dto_1.ChangePasswordDto.parse(req.body);
        await (0, service_1.changePassword)(req.userId, input);
        res.json({ success: true });
    }
    catch (e) {
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
exports.router.get('/notifications', auth_1.requireAuth, async (_req, res) => {
    try {
        const notifications = await prisma_1.prisma.notice.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        return res.json({ notifications });
    }
    catch (error) {
        console.error('notifications error', error);
        return res.status(500).json({ message: 'Failed to load notifications' });
    }
});
