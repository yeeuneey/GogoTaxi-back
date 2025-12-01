import { prisma } from '../../lib/prisma';
import { ensureBalanceForDebit, recordTransaction } from '../wallet/service';
import { splitCollectPerHead, splitRefundPerHead } from './pricing';
import { SettlementRecordStatus, SettlementRole, WalletTxKind } from '@prisma/client';
import { sendNotification } from '../notifications/service';

const idKey = (roomId: string, phase: string, userId: string) => `room:${roomId}:${phase}:${userId}`;

async function upsertSettlement(params: {
  roomId: string;
  userId: string;
  role: SettlementRole;
  deposit?: number;
  extraCollect?: number;
  refund?: number;
  netAmount?: number;
  noShow?: boolean;
  status?: SettlementRecordStatus;
}) {
  const { roomId, userId, role, ...data } = params;
  await prisma.roomSettlement.upsert({
    where: { roomId_userId: { roomId, userId } },
    update: { role, ...data },
    create: { roomId, userId, role, ...data }
  });
}

export async function holdEstimatedFare(roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { participants: true, creator: true }
  });
  if (!room) throw new Error('ROOM_NOT_FOUND');
  if (room.estimatedFare == null) throw new Error('ESTIMATED_FARE_MISSING');

  const memberIds = Array.from(new Set([room.creatorId, ...room.participants.map((p) => p.userId)]));
  const perHead = splitCollectPerHead(room.estimatedFare, memberIds.length);

  for (const userId of memberIds) {
    const isHost = userId === room.creatorId;
    await ensureBalanceForDebit(userId, perHead, { roomId, reason: 'hold' });
    const kind = isHost ? WalletTxKind.host_charge : WalletTxKind.hold_deposit;
    await recordTransaction({
      userId,
      roomId,
      kind,
      amount: -perHead,
      idempotencyKey: idKey(roomId, 'hold', userId)
    });
    await upsertSettlement({
      roomId,
      userId,
      role: userId === room.creatorId ? SettlementRole.host : SettlementRole.guest,
      deposit: perHead,
      netAmount: perHead,
      status: SettlementRecordStatus.pending
    });
    sendNotification({
      userId,
      title: `방 "${room.title}" 예치금 차감`,
      body: `${perHead.toLocaleString()}원이 예치금으로 차감되었습니다.`,
      metadata: { roomId }
    });
  }

  await prisma.room.update({
    where: { id: roomId },
    data: { settlementStatus: 'deposit_collected' }
  });

  return { perHead, collectedFrom: memberIds.length };
}

export async function finalizeRoomSettlement(roomId: string, actualFare: number) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      participants: true,
      creator: true
    }
  });
  if (!room) throw new Error('ROOM_NOT_FOUND');
  if (room.estimatedFare == null) throw new Error('ESTIMATED_FARE_MISSING');

  const memberIds = Array.from(new Set([room.creatorId, ...room.participants.map((p) => p.userId)]));
  const noShow = new Set(room.noShowUserIds ?? []);

  const delta = actualFare - room.estimatedFare;
  const activeForExtra = memberIds.filter((id) => !noShow.has(id));

  let extraPerHead = 0;
  let refundPerHead = 0;

  if (delta > 0 && activeForExtra.length > 0) {
    extraPerHead = splitCollectPerHead(delta, activeForExtra.length);
    for (const userId of activeForExtra) {
      const isHost = userId === room.creatorId;
      await ensureBalanceForDebit(userId, extraPerHead, { roomId, reason: 'extra' });
      await recordTransaction({
        userId,
        roomId,
        kind: WalletTxKind.extra_collect,
        amount: -extraPerHead,
        idempotencyKey: idKey(roomId, 'extra', userId)
      });
      await upsertSettlement({
        roomId,
        userId,
        role: userId === room.creatorId ? SettlementRole.host : SettlementRole.guest,
        extraCollect: extraPerHead,
        netAmount: extraPerHead
      });
    }
  }

  if (delta < 0 && memberIds.length > 0) {
    refundPerHead = splitRefundPerHead(Math.abs(delta), memberIds.length);
    for (const userId of memberIds) {
      await recordTransaction({
        userId,
        roomId,
        kind: WalletTxKind.refund,
        amount: refundPerHead,
        idempotencyKey: idKey(roomId, 'refund', userId)
      });
      await upsertSettlement({
        roomId,
        userId,
        role: userId === room.creatorId ? SettlementRole.host : SettlementRole.guest,
        refund: refundPerHead,
        netAmount: -refundPerHead,
        noShow: noShow.has(userId),
        status: SettlementRecordStatus.settled
      });
    }
  }

  await prisma.room.update({
    where: { id: roomId },
    data: {
      actualFare,
      settlementStatus: 'settled',
      status: 'closed'
    }
  });

  const settledAt = new Date();
  const settlementRecords = await prisma.roomSettlement.findMany({
    where: { roomId },
    select: {
      userId: true,
      role: true,
      deposit: true,
      extraCollect: true,
      refund: true,
      netAmount: true
    }
  });
  await prisma.$transaction(async (tx) => {
    const rideHistoryDelegate = (tx as any)?.rideHistory as typeof prisma.rideHistory | undefined;
    if (!rideHistoryDelegate || typeof rideHistoryDelegate.upsert !== 'function') {
      console.warn('rideHistory delegate is unavailable; skipping history upsert.');
    } else {
      for (const record of settlementRecords) {
        const payload = {
          role: record.role,
          deposit: record.deposit,
          extraCollect: record.extraCollect,
          refund: record.refund,
          netAmount: record.netAmount,
          actualFare,
          settledAt
        };
        await rideHistoryDelegate.upsert({
          where: { roomId_userId: { roomId, userId: record.userId } },
          update: payload,
          create: {
            roomId,
            userId: record.userId,
            ...payload
          }
        });
      }
    }
    await tx.roomParticipant.deleteMany({ where: { roomId } });
  });

  const summary =
    delta === 0
      ? '추가 정산 금액 없이 종료되었습니다.'
      : delta > 0
        ? `예상보다 ${delta.toLocaleString()}원 더 나와 추가 징수되었습니다.`
        : `예상보다 ${Math.abs(delta).toLocaleString()}원 적게 나와 환급되었습니다.`;

  for (const userId of memberIds) {
    sendNotification({
      userId,
      title: `방 "${room.title}" 정산 완료`,
      body: `실요금 ${actualFare.toLocaleString()}원으로 정산되었습니다. ${summary}`,
      metadata: { roomId, delta }
    });
  }

  return { delta, extraPerHead, refundPerHead };
}
