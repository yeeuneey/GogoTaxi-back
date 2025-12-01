import { Prisma, WalletTxKind, WalletTxStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { mockCharge } from '../payments/mockClient';

type RecordTxInput = {
  userId: string;
  roomId?: string;
  kind: WalletTxKind;
  amount: number; // +credit, -debit
  currency?: string;
  status?: WalletTxStatus;
  allowNegative?: boolean;
  idempotencyKey?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function getBalance(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletBalance: true }
  });
  if (!user) throw new Error('USER_NOT_FOUND');
  return user.walletBalance;
}

export async function recordTransaction(input: RecordTxInput) {
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const dup = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      if (dup) return dup;
    }

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { walletBalance: true }
    });
    if (!user) throw new Error('USER_NOT_FOUND');

    const nextBalance = user.walletBalance + input.amount;
    if (!input.allowNegative && nextBalance < 0) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const txRecord = await tx.walletTransaction.create({
      data: {
        userId: input.userId,
        roomId: input.roomId,
        kind: input.kind,
        amount: input.amount,
        status: input.status ?? WalletTxStatus.success,
        currency: input.currency ?? 'KRW',
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey
      }
    });

    await tx.user.update({
      where: { id: input.userId },
      data: { walletBalance: nextBalance }
    });

    return txRecord;
  });
}

export async function ensureBalanceForDebit(userId: string, amount: number, opts?: { roomId?: string; reason?: string }) {
  const current = await getBalance(userId);
  if (current >= amount) {
    return { autoTopUp: false, deficit: 0 };
  }
  const deficit = amount - current;
  const topUpAmount = Math.ceil(deficit / 10000) * 10000;
  const payment = mockCharge({
    amount: topUpAmount,
    currency: 'KRW',
    metadata: { userId, roomId: opts?.roomId, reason: opts?.reason }
  });
  await recordTransaction({
    userId,
    roomId: opts?.roomId,
    kind: WalletTxKind.auto_top_up,
    amount: topUpAmount,
    idempotencyKey: `auto_top_up:${opts?.reason ?? 'debit'}:${opts?.roomId ?? 'general'}:${userId}:${payment.id}`
  });
  return { autoTopUp: true, deficit, payment, topUpAmount };
}
