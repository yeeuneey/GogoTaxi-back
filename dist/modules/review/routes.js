"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middlewares/auth");
const dto_1 = require("./dto");
const service_1 = require("./service");
exports.reviewRouter = (0, express_1.Router)();
exports.reviewRouter.use(auth_1.requireAuth);
exports.reviewRouter.post('/', async (req, res) => {
    try {
        const input = dto_1.CreateReviewDto.parse(req.body);
        const review = await (0, service_1.createReview)(req.user.sub, input);
        res.status(201).json({ review });
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        if (e?.message === 'ROOM_NOT_FOUND')
            return res.status(404).json({ message: 'Room not found' });
        if (e?.message === 'NOT_IN_ROOM')
            return res.status(403).json({ message: 'Room participation required' });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.reviewRouter.get('/room/:roomId', async (req, res) => {
    try {
        const params = zod_1.z.object({ roomId: zod_1.z.string().cuid() }).parse(req.params);
        const reviews = await (0, service_1.listRoomReviews)(params.roomId);
        res.json({ reviews });
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.reviewRouter.get('/me', async (req, res) => {
    try {
        const reviews = await (0, service_1.listMyReviews)(req.user.sub);
        res.json({ reviews });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
