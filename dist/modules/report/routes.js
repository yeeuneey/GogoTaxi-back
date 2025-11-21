"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middlewares/auth");
const dto_1 = require("./dto");
const service_1 = require("./service");
exports.reportRouter = (0, express_1.Router)();
exports.reportRouter.use(auth_1.requireAuth);
exports.reportRouter.post('/', async (req, res) => {
    try {
        const input = dto_1.CreateReportDto.parse(req.body);
        const report = await (0, service_1.createReport)(req.user.sub, input);
        res.status(201).json({ report });
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
exports.reportRouter.get('/room/:roomId', async (req, res) => {
    try {
        const params = zod_1.z.object({ roomId: zod_1.z.string().cuid() }).parse(req.params);
        const reports = await (0, service_1.listRoomReports)(params.roomId);
        res.json({ reports });
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.reportRouter.get('/me', async (req, res) => {
    try {
        const reports = await (0, service_1.listMyReports)(req.user.sub);
        res.json({ reports });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
