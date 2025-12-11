"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const routes_1 = require("../modules/auth/routes");
const auth_1 = require("../middlewares/auth");
const prisma_1 = require("../lib/prisma");
const room_routes_1 = __importDefault(require("./room.routes"));
const ride_routes_1 = __importDefault(require("./ride.routes"));
const routes_2 = require("../modules/payments/routes");
const routes_3 = require("../modules/wallet/routes");
const service_1 = require("../modules/auth/service");
const dto_1 = require("../modules/auth/dto");
const routes_4 = require("../modules/settlement/routes");
const routes_5 = require("../modules/notifications/routes");
const routes_6 = require("../modules/review/routes");
const routes_7 = require("../modules/report/routes");
const routes_8 = require("../modules/rideHistory/routes");
const receiptService_1 = require("../modules/rideHistory/receiptService");
const service_2 = require("../modules/settlement/service");
exports.router = (0, express_1.Router)();
exports.router.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
});
exports.router.use('/auth', routes_1.authRouter);
exports.router.use('/payments', routes_2.paymentsRouter);
exports.router.use('/wallet', routes_3.walletRouter);
exports.router.use('/settlements', routes_4.settlementRouter);
exports.router.use(room_routes_1.default);
exports.router.use(ride_routes_1.default);
exports.router.use('/rides', routes_8.rideHistoryRouter);
exports.router.use('/notifications', routes_5.notificationsRouter);
exports.router.use('/reviews', routes_6.reviewRouter);
exports.router.use('/reports', routes_7.reportRouter);
exports.router.post('/receipts/analyze', auth_1.requireAuth, async (req, res) => {
    try {
        const input = zod_1.z
            .object({
            imageBase64: zod_1.z.string().min(20, 'imageBase64 is required'),
            mimeType: zod_1.z.string().optional(),
            prompt: zod_1.z.string().optional(),
            roomId: zod_1.z.string().cuid().optional(),
            action: zod_1.z.enum(['hold', 'finalize']).optional()
        })
            .refine((val) => !val.action || !!val.roomId, {
            message: 'roomId is required when action is provided',
            path: ['roomId']
        })
            .parse(req.body);
        const analysis = await (0, receiptService_1.analyzeReceiptImage)(input);
        let settlement = null;
        if (input.action && input.roomId) {
            const amount = normalizeReceiptAmount(analysis);
            const room = await prisma_1.prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true, creatorId: true } });
            if (!room) {
                return res.status(404).json({ message: 'Room not found' });
            }
            const authUserId = req?.user?.sub;
            if (room.creatorId !== authUserId) {
                return res.status(403).json({ message: 'Only the host can manage settlement for this room' });
            }
            if (input.action === 'hold') {
                await prisma_1.prisma.room.update({ where: { id: room.id }, data: { estimatedFare: amount } });
                settlement = { action: 'hold', ...(await (0, service_2.holdEstimatedFare)(room.id)) };
            }
            else {
                settlement = { action: 'finalize', ...(await (0, service_2.finalizeRoomSettlement)(room.id, amount)) };
            }
        }
        res.json({ analysis, settlement });
    }
    catch (e) {
        if (e?.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        }
        if (e?.message === 'INVALID_IMAGE_BASE64' || e?.message === 'IMAGE_BASE64_REQUIRED') {
            return res.status(400).json({ message: 'Invalid or unsupported receipt image payload' });
        }
        if (e?.message === 'RECEIPT_TOTAL_MISSING') {
            return res.status(422).json({ message: 'Receipt does not contain a recognizable total amount' });
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
        if (typeof e?.status === 'number' &&
            e.status >= 400 &&
            e.status < 500 &&
            typeof e?.message === 'string' &&
            e.message.includes('GEMINI_REQUEST_FAILED')) {
            return res
                .status(400)
                .json({ message: e?.geminiMessage || 'Gemini에서 이미지를 처리하지 못했습니다. 다른 형식으로 시도해 주세요.' });
        }
        if (e?.message === 'GEMINI_API_KEY_NOT_CONFIGURED') {
            return res.status(500).json({ message: 'Gemini API key is not configured.' });
        }
        console.error('receipt analyze error', e);
        const isGeminiUnavailable = typeof e?.message === 'string' &&
            (e.message.includes('GEMINI_FETCH_FAILED') || e.message.includes('GEMINI_REQUEST_FAILED'));
        res.status(isGeminiUnavailable ? 502 : 500).json({
            message: isGeminiUnavailable
                ? 'Gemini Vision 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.'
                : e?.message || 'Failed to analyze receipt'
        });
    }
});
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
function normalizeReceiptAmount(analysis) {
    const amount = typeof analysis.totalAmount === 'number' && Number.isFinite(analysis.totalAmount)
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
