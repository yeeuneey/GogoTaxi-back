"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReview = createReview;
exports.listRoomReviews = listRoomReviews;
exports.listMyReviews = listMyReviews;
const prisma_1 = require("../../lib/prisma");
async function assertUserCanReview(roomId, userId) {
    const room = await prisma_1.prisma.room.findUnique({
        where: { id: roomId },
        select: { creatorId: true }
    });
    if (!room)
        throw new Error('ROOM_NOT_FOUND');
    if (room.creatorId === userId)
        return true;
    const participant = await prisma_1.prisma.roomParticipant.findFirst({
        where: { roomId, userId }
    });
    if (!participant)
        throw new Error('NOT_IN_ROOM');
    return true;
}
async function createReview(userId, input) {
    await assertUserCanReview(input.roomId, userId);
    return prisma_1.prisma.review.create({
        data: {
            roomId: input.roomId,
            reviewerUserId: userId,
            rating: input.rating,
            comment: input.comment
        }
    });
}
async function listRoomReviews(roomId) {
    return prisma_1.prisma.review.findMany({
        where: { roomId },
        include: {
            reviewer: { select: { id: true, nickname: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
}
async function listMyReviews(userId) {
    return prisma_1.prisma.review.findMany({
        where: { reviewerUserId: userId },
        orderBy: { createdAt: 'desc' }
    });
}
