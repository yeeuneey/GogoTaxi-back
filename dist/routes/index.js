"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const routes_1 = require("../modules/auth/routes");
const auth_1 = require("../middlewares/auth");
const prisma_1 = require("../lib/prisma");
const room_routes_1 = __importDefault(require("./room.routes"));
const ride_routes_1 = __importDefault(require("./ride.routes"));
exports.router = (0, express_1.Router)();
exports.router.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
});
exports.router.use('/auth', routes_1.authRouter);
exports.router.use(room_routes_1.default);
exports.router.use(ride_routes_1.default);
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
