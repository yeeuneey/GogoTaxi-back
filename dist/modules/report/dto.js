"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateReportDto = void 0;
const zod_1 = require("zod");
exports.CreateReportDto = zod_1.z.object({
    roomId: zod_1.z.string().cuid(),
    reportedSeatNumber: zod_1.z.number().int().min(1),
    message: zod_1.z.string().min(5).max(5000)
});
