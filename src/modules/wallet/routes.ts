import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/auth';
import { ChargeDto, TopUpDto } from './dto';
import { ensureBalanceForDebit, getBalance, recordTransaction } from './service';
import { WalletTxKind } from '@prisma/client';
import multer from 'multer';
import { extractAmountFromImage } from '../payments/gemini';

export const walletRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

function normalizeLooseText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function matchesDepositUi(rawText: string, uiKeywords?: string[]): boolean {
  const trimmed = (rawText || '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return false;

  const normalized = normalizeLooseText(trimmed);
  if (!normalized) return false;

  const generalTaxiToken = normalizeLooseText('일반 택시');
  if (!normalized.includes(generalTaxiToken)) {
    return false;
  }

  const receiptTokens = ['영수증', 'receipt', '합계', '총액', 'total'].map(normalizeLooseText);
  if (receiptTokens.some(token => token && normalized.includes(token))) {
    return false;
  }

  const tokens = ['차량 서비스 선택', '일반 택시', '스피드 호출', 'Uber Taxi'].map(normalizeLooseText);
  const keywordPool = Array.isArray(uiKeywords) ? uiKeywords.map(normalizeLooseText) : [];
  const matchedFromText = normalized
    ? tokens.filter(token => normalized.includes(token)).length
    : 0;
  const matchedFromKeywords = tokens.filter(token => keywordPool.includes(token)).length;
  if (matchedFromText === 0) return false;
  return matchedFromText + matchedFromKeywords >= 2;
}

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
    if (e?.message === 'ROOM_NOT_FOUND') return res.status(404).json({ message: 'Room not found' });
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
    if (e?.message === 'ROOM_NOT_FOUND') return res.status(404).json({ message: 'Room not found' });
    if (e?.message === 'INSUFFICIENT_BALANCE') return res.status(402).json({ message: 'Insufficient balance' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

walletRouter.post('/receipt/amount', upload.single('image'), async (req, res) => {
  try {
    const imageBase64 =
      req.file?.buffer?.toString('base64') ?? (typeof (req.body as any).imageBase64 === 'string' ? (req.body as any).imageBase64 : null);
    const mimeType = req.file?.mimetype ?? (typeof (req.body as any).mimeType === 'string' ? (req.body as any).mimeType : undefined);

    console.log('receipt/amount request', {
      hasFile: !!req.file,
      fileSize: req.file?.size,
      mimeType,
      hasBase64Field: typeof (req.body as any).imageBase64 === 'string'
    });

    if (!imageBase64) {
      return res.status(400).json({ message: 'imageBase64 or image file is required' });
    }

    const result = await extractAmountFromImage(imageBase64, mimeType);
    if (result.amount == null) {
      console.warn('Receipt OCR failed', { reason: result.reason, rawText: result.rawText?.slice(0, 200) });
      return res.status(422).json({
        message: 'Failed to recognize amount from image',
        reason: result.reason,
        rawText: result.rawText
      });
    }
    if (!matchesDepositUi(result.rawText, result.uiKeywords)) {
      return res.status(422).json({
        message: 'Deposit screen UI does not match expected template',
        reason: 'UNSUPPORTED_DEPOSIT_UI',
        rawText: result.rawText
      });
    }

    const amount = Math.round(result.amount);
    const { autoTopUp, deficit, payment } = await ensureBalanceForDebit(req.user!.sub, amount, {
      reason: 'receipt_upload'
    });

    return res.json({
      amount,
      autoTopUp,
      deficit,
      payment,
      rawText: result.rawText
    });
  } catch (e: any) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    }
    if (e?.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'User not found' });
    }
    if (e?.message === 'INSUFFICIENT_BALANCE') {
      return res.status(402).json({ message: 'Insufficient balance' });
    }
    console.error('receipt/amount error', e);
    return res.status(500).json({ message: 'Failed to process receipt amount', error: e?.message ?? 'unknown' });
  }
});
