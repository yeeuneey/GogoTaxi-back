import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { ChargeDto, TopUpDto } from './dto';
import { ensureBalanceForDebit, getBalance, recordTransaction } from './service';
import { WalletTxKind } from '@prisma/client';

export const walletRouter = Router();

walletRouter.use(requireAuth);

walletRouter.get('/balance', async (req, res) => {
  try {
    const balance = await getBalance(req.user!.sub);
    res.json({ balance });
  } catch (e: any) {
    if (e?.message === 'USER_NOT_FOUND') return res.status(404).json({ message: 'User not found' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

walletRouter.post('/topup', async (req, res) => {
  try {
    const input = TopUpDto.parse(req.body);
    const tx = await recordTransaction({
      userId: req.user!.sub,
      roomId: input.roomId,
      kind: WalletTxKind.top_up,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey
    });
    res.status(201).json({ transaction: tx });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'USER_NOT_FOUND') return res.status(404).json({ message: 'User not found' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

walletRouter.post('/charge', async (req, res) => {
  try {
    const input = ChargeDto.parse(req.body);
    const sign = input.kind === 'refund' || input.kind === 'host_refund' ? 1 : -1;
    if (sign === -1 && !input.allowNegative) {
      await ensureBalanceForDebit(req.user!.sub, input.amount, {
        roomId: input.roomId,
        reason: input.kind
      });
    }
    const tx = await recordTransaction({
      userId: req.user!.sub,
      roomId: input.roomId,
      kind: input.kind as WalletTxKind,
      amount: sign * input.amount,
      idempotencyKey: input.idempotencyKey,
      allowNegative: input.allowNegative,
      metadata: input.metadata as any
    });
    res.status(201).json({ transaction: tx });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (e?.message === 'USER_NOT_FOUND') return res.status(404).json({ message: 'User not found' });
    if (e?.message === 'INSUFFICIENT_BALANCE') return res.status(402).json({ message: 'Insufficient balance' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});
