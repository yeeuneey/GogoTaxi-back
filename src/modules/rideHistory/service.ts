import { prisma } from '../../lib/prisma';

export async function listRideHistory(userId: string) {
  const delegate = (prisma as any)?.rideHistory as typeof prisma.rideHistory | undefined;
  if (!delegate) {
    console.warn('rideHistory delegate unavailable; returning empty history.');
    return [];
  }
  return delegate.findMany({
    where: { userId },
    include: {
      room: {
        select: {
          id: true,
          title: true,
          departureLabel: true,
          arrivalLabel: true,
          departureTime: true
        }
      }
    },
    orderBy: { settledAt: 'desc' }
  });
}
