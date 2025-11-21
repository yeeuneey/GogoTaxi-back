"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateReviewDto = void 0;
const zod_1 = require("zod");
exports.CreateReviewDto = zod_1.z.object({
    roomId: zod_1.z.string().cuid(),
    rating: zod_1.z.number().int().min(1).max(5),
    comment: zod_1.z.string().max(2000).optional()
});
