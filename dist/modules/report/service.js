"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReport = createReport;
exports.listRoomReports = listRoomReports;
exports.listMyReports = listMyReports;
const prisma_1 = require("../../lib/prisma");
async function assertUserInRoom(roomId, userId) {
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
async function createReport(userId, input) {
    await assertUserInRoom(input.roomId, userId);
    return prisma_1.prisma.report.create({
        data: {
            roomId: input.roomId,
            reporterUserId: userId,
            reportedSeatNumber: input.reportedSeatNumber,
            message: input.message
        }
    });
}
async function listRoomReports(roomId) {
    return prisma_1.prisma.report.findMany({
        where: { roomId },
        include: {
            reporter: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
}
async function listMyReports(userId) {
    return prisma_1.prisma.report.findMany({
        where: { reporterUserId: userId },
        orderBy: { createdAt: 'desc' }
    });
}
