import { prisma } from '../../lib/prisma';
import { CreateReviewDto } from './dto';

async function assertUserCanReview(roomId: string, userId: string) {
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

export async function createReview(userId: string, input: CreateReviewDto) {
  await assertUserCanReview(input.roomId, userId);
  return prisma.review.create({
    data: {
      roomId: input.roomId,
      reviewerUserId: userId,
      rating: input.rating,
      comment: input.comment
    }
  });
}

export async function listRoomReviews(roomId: string) {
  return prisma.review.findMany({
    where: { roomId },
    include: {
      reviewer: { select: { id: true, nickname: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function listMyReviews(userId: string) {
  return prisma.review.findMany({
    where: { reviewerUserId: userId },
    orderBy: { createdAt: 'desc' }
  });
}
