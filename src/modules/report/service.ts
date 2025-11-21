import { prisma } from '../../lib/prisma';
import { CreateReportDto } from './dto';

async function assertUserInRoom(roomId: string, userId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { creatorId: true }
  });
  if (!room) throw new Error('ROOM_NOT_FOUND');
  if (room.creatorId === userId) return true;

  const participant = await prisma.roomParticipant.findFirst({
    where: { roomId, userId }
  });
  if (!participant) throw new Error('NOT_IN_ROOM');
  return true;
}

export async function createReport(userId: string, input: CreateReportDto) {
  await assertUserInRoom(input.roomId, userId);
  return prisma.report.create({
    data: {
      roomId: input.roomId,
      reporterUserId: userId,
      reportedSeatNumber: input.reportedSeatNumber,
      message: input.message
    }
  });
}

export async function listRoomReports(roomId: string) {
  return prisma.report.findMany({
    where: { roomId },
    include: {
      reporter: { select: { id: true, nickname: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function listMyReports(userId: string) {
  return prisma.report.findMany({
    where: { reporterUserId: userId },
    orderBy: { createdAt: 'desc' }
  });
}
