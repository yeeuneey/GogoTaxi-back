import type { Request, Response } from 'express';
import { Prisma, RoomRideStage, RoomStatus } from '@prisma/client';
import { z } from 'zod';
import { ENV } from '../config/env';
import { prisma } from '../lib/prisma';
import {
  broadcastRoom,
  defaultRoomInclude,
  loadRoomOrThrow,
  serializeRideState,
  serializeRoom
} from './room.controller';
import { analyzeDispatchScreenshot } from '../modules/ride/dispatchVisionService';
import { holdEstimatedFare } from '../modules/settlement/service';

const uberDeeplinkSchema = z
  .object({
    pickupLat: z.coerce.number(),
    pickupLng: z.coerce.number(),
    pickupLabel: z.string().min(1).optional(),
    pickupNickname: z.string().min(1).optional(),
    dropoffLat: z.coerce.number(),
    dropoffLng: z.coerce.number(),
    dropoffLabel: z.string().min(1).optional(),
    dropoffNickname: z.string().min(1).optional(),
    productId: z.string().min(1).optional(),
    pickupTime: z.coerce.date().optional(),
    note: z.string().max(200).optional()
  })
  .refine(data => Number.isFinite(data.pickupLat) && Number.isFinite(data.pickupLng), {
    message: 'Pickup coordinates are required',
    path: ['pickupLat']
  })
  .refine(data => Number.isFinite(data.dropoffLat) && Number.isFinite(data.dropoffLng), {
    message: 'Dropoff coordinates are required',
    path: ['dropoffLat']
  });

const rideStageUpdateSchema = z.object({
  stage: z.nativeEnum(RoomRideStage),
  note: z.string().max(200).optional(),
  driverName: z.string().max(100).optional(),
  carModel: z.string().max(100).optional(),
  carNumber: z.string().max(50).optional()
});

const dispatchScreenshotSchema = z.object({
  imageBase64: z.string().min(20, 'imageBase64 is required'),
  mimeType: z.string().optional(),
  prompt: z.string().optional()
});

const roomParamSchema = z.object({ id: z.string().cuid() });

const toDecimal = (value: number) => new Prisma.Decimal(value);
const DEFAULT_UBER_CLIENT_ID = 'gogotaxi-demo';

function buildUberDeeplinkUrls(payload: z.infer<typeof uberDeeplinkSchema>) {
  const clientId = ENV.UBER_CLIENT_ID || DEFAULT_UBER_CLIENT_ID;
  const web = new URL('https://m.uber.com/ul/');
  web.searchParams.set('action', 'setPickup');
  web.searchParams.set('client_id', clientId);
  web.searchParams.set('pickup[latitude]', payload.pickupLat.toString());
  web.searchParams.set('pickup[longitude]', payload.pickupLng.toString());
  if (payload.pickupNickname) {
    web.searchParams.set('pickup[nickname]', payload.pickupNickname);
  }
  web.searchParams.set('dropoff[latitude]', payload.dropoffLat.toString());
  web.searchParams.set('dropoff[longitude]', payload.dropoffLng.toString());
  if (payload.dropoffNickname) {
    web.searchParams.set('dropoff[nickname]', payload.dropoffNickname);
  }
  if (payload.productId) {
    web.searchParams.set('product_id', payload.productId);
  }
  if (payload.pickupTime) {
    web.searchParams.set('pickup[time]', Math.floor(payload.pickupTime.getTime() / 1000).toString());
  }

  // Native scheme for iOS/Android app deep links; some devices ignore the web URL params.
  const app = `uber://?${web.searchParams.toString()}`;
  return { web: web.toString(), app };
}

function allowedNextStages(current: RoomRideStage): RoomRideStage[] {
  const transitions: Record<RoomRideStage, RoomRideStage[]> = {
    [RoomRideStage.idle]: [RoomRideStage.requesting, RoomRideStage.deeplink_ready],
    [RoomRideStage.requesting]: [RoomRideStage.deeplink_ready, RoomRideStage.dispatching],
    [RoomRideStage.deeplink_ready]: [RoomRideStage.dispatching, RoomRideStage.canceled],
    [RoomRideStage.dispatching]: [RoomRideStage.driver_assigned, RoomRideStage.canceled],
    [RoomRideStage.driver_assigned]: [RoomRideStage.arriving, RoomRideStage.canceled],
    [RoomRideStage.arriving]: [RoomRideStage.onboard, RoomRideStage.canceled],
    [RoomRideStage.onboard]: [RoomRideStage.completed, RoomRideStage.canceled],
    [RoomRideStage.completed]: [],
    [RoomRideStage.canceled]: []
  };
  return transitions[current] ?? [];
}

export function createUberDeeplink(req: Request, res: Response) {
  const merged = { ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown>) };
  const parsed = uberDeeplinkSchema.safeParse(merged);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
  }

  const payload = parsed.data;
  const deeplinks = buildUberDeeplinkUrls(payload);

  return res.json({ url: deeplinks.web, appUrl: deeplinks.app });
}

export async function getRoomRideState(req: Request, res: Response) {
  const param = roomParamSchema.safeParse(req.params);
  if (!param.success) {
    return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
  }

  try {
    const rideState = await prisma.roomRideState.findUnique({ where: { roomId: param.data.id } });
    return res.json({ rideState: serializeRideState(rideState) });
  } catch (error) {
    console.error('getRoomRideState error', error);
    return res.status(500).json({ message: 'Failed to load ride state' });
  }
}

export async function requestRoomUberRide(req: Request, res: Response) {
  const param = roomParamSchema.safeParse(req.params);
  if (!param.success) {
    return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
  }
  const userId = (req as any).user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // Load room early so we can supply missing pickup/dropoff data from the room itself.
    const room = await prisma.room.findUnique({
      where: { id: param.data.id },
      select: {
        id: true,
        creatorId: true,
        status: true,
        capacity: true,
        participants: true,
        departureLabel: true,
        departureLat: true,
        departureLng: true,
        arrivalLabel: true,
        arrivalLat: true,
        arrivalLng: true
      }
    });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (room.creatorId !== userId) {
      return res.status(403).json({ message: '호스트만 우버 호출을 진행할 수 있습니다.' });
    }
    if (room.participants.length > room.capacity) {
      return res.status(400).json({ message: 'Room capacity exceeded' });
    }

    // Merge client payload with room defaults so front-end can omit coordinates/labels.
    const merged = { ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown>) };
    const mergedWithDefaults = {
      pickupLat: merged.pickupLat ?? room.departureLat?.toNumber(),
      pickupLng: merged.pickupLng ?? room.departureLng?.toNumber(),
      pickupLabel: merged.pickupLabel ?? merged.pickupNickname ?? room.departureLabel,
      dropoffLat: merged.dropoffLat ?? room.arrivalLat?.toNumber(),
      dropoffLng: merged.dropoffLng ?? room.arrivalLng?.toNumber(),
      dropoffLabel: merged.dropoffLabel ?? merged.dropoffNickname ?? room.arrivalLabel,
      pickupNickname: merged.pickupNickname,
      dropoffNickname: merged.dropoffNickname,
      productId: merged.productId,
      pickupTime: merged.pickupTime,
      note: merged.note
    };

    const parsed = uberDeeplinkSchema.safeParse(mergedWithDefaults);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
    }

    const payload = parsed.data;
    const deeplinks = buildUberDeeplinkUrls(payload);

    const rideState = await prisma.roomRideState.upsert({
      where: { roomId: room.id },
      create: {
        roomId: room.id,
        stage: RoomRideStage.requesting,
        deeplinkUrl: deeplinks.web,
        pickupLabel: payload.pickupNickname ?? payload.pickupLabel ?? null,
        pickupLat: toDecimal(payload.pickupLat),
        pickupLng: toDecimal(payload.pickupLng),
        dropoffLabel: payload.dropoffNickname ?? payload.dropoffLabel ?? null,
        dropoffLat: toDecimal(payload.dropoffLat),
        dropoffLng: toDecimal(payload.dropoffLng),
        note: payload.note ?? null,
        updatedById: userId
      },
      update: {
        stage: RoomRideStage.requesting,
        deeplinkUrl: deeplinks.web,
        pickupLabel: payload.pickupNickname ?? payload.pickupLabel ?? null,
        pickupLat: toDecimal(payload.pickupLat),
        pickupLng: toDecimal(payload.pickupLng),
        dropoffLabel: payload.dropoffNickname ?? payload.dropoffLabel ?? null,
        dropoffLat: toDecimal(payload.dropoffLat),
        dropoffLng: toDecimal(payload.dropoffLng),
        note: payload.note ?? null,
        updatedById: userId
      }
    });

    if (room.status !== RoomStatus.dispatching) {
      await prisma.room.update({ where: { id: room.id }, data: { status: RoomStatus.dispatching } });
    }

    const updatedRoom = await loadRoomOrThrow(room.id);
    broadcastRoom(updatedRoom, userId);
    return res.status(201).json({
      rideState: serializeRideState(rideState),
      room: serializeRoom(updatedRoom, userId),
      url: deeplinks.web,
      appUrl: deeplinks.app
    });
  } catch (error) {
    console.error('requestRoomUberRide error', error);
    return res.status(500).json({ message: 'Failed to request Uber ride' });
  }
}

export async function updateRideStage(req: Request, res: Response) {
  const param = roomParamSchema.safeParse(req.params);
  if (!param.success) {
    return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
  }
  const body = rideStageUpdateSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: 'Validation failed', issues: body.error.issues });
  }

  const userId = (req as any).user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const room = await prisma.room.findUnique({
      where: { id: param.data.id },
      select: { id: true, creatorId: true }
    });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (room.creatorId !== userId) {
      return res.status(403).json({ message: '호스트만 배차 단계를 변경할 수 있습니다.' });
    }

    const current = await prisma.roomRideState.upsert({
      where: { roomId: room.id },
      create: { roomId: room.id, stage: RoomRideStage.idle },
      update: {}
    });

    const allowed = allowedNextStages(current.stage);
    if (current.stage !== body.data.stage && !allowed.includes(body.data.stage)) {
      return res.status(400).json({ message: '해당 단계로 전환할 수 없습니다.', current: current.stage });
    }

    const rideState = await prisma.roomRideState.update({
      where: { roomId: room.id },
      data: {
        stage: body.data.stage,
        note: body.data.note ?? current.note,
        driverName: body.data.driverName ?? current.driverName,
        carModel: body.data.carModel ?? current.carModel,
        carNumber: body.data.carNumber ?? current.carNumber,
        updatedById: userId
      }
    });

    if (body.data.stage === RoomRideStage.completed) {
      await prisma.room.update({ where: { id: room.id }, data: { status: RoomStatus.success } });
    } else if (body.data.stage === RoomRideStage.canceled) {
      await prisma.room.update({ where: { id: room.id }, data: { status: RoomStatus.failed } });
    }

    const updatedRoom = await prisma.room.findUnique({
      where: { id: room.id },
      include: defaultRoomInclude
    });
    if (!updatedRoom) {
      return res.status(404).json({ message: 'Room not found after update' });
    }

    broadcastRoom(updatedRoom, userId);
  return res.json({ rideState: serializeRideState(rideState), room: serializeRoom(updatedRoom, userId) });
  } catch (error) {
    console.error('updateRideStage error', error);
    return res.status(500).json({ message: 'Failed to update ride stage' });
  }
}

const PROMOTABLE_STAGES = new Set<RoomRideStage>([
  RoomRideStage.idle,
  RoomRideStage.requesting,
  RoomRideStage.deeplink_ready,
  RoomRideStage.dispatching
]);

function normalizePipe(value?: string | null) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length ? trimmed : null;
}

function normalizeLooseText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function extractLocationTokens(label: string): string[] {
  const matches = label.match(/[0-9A-Za-z가-힣]+/g);
  if (!matches) return [];
  return matches
    .map(token => token.trim())
    .filter(token => token.length >= 2 || /^\d+$/.test(token));
}

function matchesLocationLabel(rawText: string, label: string): boolean {
  const tokens = extractLocationTokens(label);
  if (!tokens.length) return false;

  const normalizedRaw = normalizeLooseText(rawText);
  if (!normalizedRaw) return false;

  let hasNonNumericMatch = false;
  for (const token of tokens) {
    const normalizedToken = normalizeLooseText(token);
    if (!normalizedToken) continue;
    if (!normalizedRaw.includes(normalizedToken)) continue;
    if (/[A-Za-z가-힣]/.test(token)) {
      hasNonNumericMatch = true;
      break;
    }
  }

  if (hasNonNumericMatch) return true;

  return tokens.some(token => /^\d+$/.test(token) && normalizedRaw.includes(token));
}

function matchesDepositUi(rawText: string): boolean {
  const normalized = normalizeLooseText(rawText);
  if (!normalized) return false;
  const receiptTokens = ['영수증', 'receipt'].map(normalizeLooseText);
  if (receiptTokens.some(token => token && normalized.includes(token))) {
    return false;
  }

  const tokens = ['차량서비스선택', '일반택시', '스피드호출', 'ubertaxi'].map(normalizeLooseText);
  const matched = tokens.filter(token => normalized.includes(token)).length;
  return matched >= 2;
}

function matchesDispatchResultUi(rawText: string): boolean {
  if (!rawText) return false;

  const normalized = normalizeLooseText(rawText);
  if (!normalized) return false;

  const keywords = [
    '배차되었습니다',
    '배차완료',
    '배차결과',
    '기사님',
    '차량번호',
    '차종',
    '차량'
  ].map(normalizeLooseText);
  const keywordMatches = keywords.filter(token => normalized.includes(token)).length;

  const platePattern = /\d{2,3}\s*[가-힣]\s*\d{4}/;
  const hasPlate = platePattern.test(rawText);

  return keywordMatches >= 2 || (keywordMatches >= 1 && hasPlate);
}

function matchesDispatchScreenshotUi(rawText: string): boolean {
  return matchesDepositUi(rawText) || matchesDispatchResultUi(rawText);
}

export async function analyzeDispatchInfo(req: Request, res: Response) {
  const param = roomParamSchema.safeParse(req.params);
  if (!param.success) {
    return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
  }

  const body = dispatchScreenshotSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: 'Validation failed', issues: body.error.issues });
  }

  const userId = (req as any).user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const room = await prisma.room.findUnique({
      where: { id: param.data.id },
      select: {
        id: true,
        creatorId: true,
        status: true,
        settlementStatus: true,
        estimatedFare: true,
        departureLabel: true,
        arrivalLabel: true
      }
    });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    if (room.creatorId !== userId) {
      return res.status(403).json({ message: '호스트만 배차 정보를 업데이트할 수 있습니다.' });
    }

    const analysis = await analyzeDispatchScreenshot(body.data);
    const normalizedDriver = normalizePipe(analysis.driverName);
    const normalizedCarNumber = normalizePipe(analysis.carNumber);
    const normalizedCarModel = normalizePipe(analysis.carModel);
    const rawText = analysis.rawText ?? '';
    const departureLabel = room.departureLabel?.trim() ?? '';
    const arrivalLabel = room.arrivalLabel?.trim() ?? '';
    if (!departureLabel || !arrivalLabel) {
      return res.status(422).json({ message: 'Room route labels are missing' });
    }
    const matchesUi = matchesDispatchScreenshotUi(rawText);
    if (!matchesUi) {
      return res.status(422).json({ message: 'Dispatch screenshot UI does not match expected screen' });
    }
    const isDispatchResult = matchesDispatchResultUi(rawText);
    if (!isDispatchResult) {
      const hasDeparture = matchesLocationLabel(rawText, departureLabel);
      const hasArrival = matchesLocationLabel(rawText, arrivalLabel);
      if (!hasDeparture || !hasArrival) {
        return res.status(422).json({ message: 'Dispatch screenshot does not match room route' });
      }
    }
    if (!matchesUi) {
      return res.status(422).json({ message: 'Dispatch screenshot UI does not match expected screen' });
    }
    if (!normalizedDriver && !normalizedCarNumber && !normalizedCarModel) {
      return res.status(422).json({ message: 'Unable to recognize dispatch information in the image' });
    }

    const currentRideState = await prisma.roomRideState.findUnique({
      where: { roomId: room.id }
    });
    const promoteStage =
      !currentRideState || PROMOTABLE_STAGES.has(currentRideState.stage ?? RoomRideStage.idle);
    const stageToApply = promoteStage
      ? RoomRideStage.driver_assigned
      : currentRideState?.stage ?? RoomRideStage.idle;

    const nextDriverName = normalizedDriver ?? currentRideState?.driverName ?? null;
    const nextCarNumber = normalizedCarNumber ?? currentRideState?.carNumber ?? null;
    const nextCarModel = normalizedCarModel ?? currentRideState?.carModel ?? null;

    const rideState = await prisma.roomRideState.upsert({
      where: { roomId: room.id },
      create: {
        roomId: room.id,
        stage: stageToApply,
        driverName: nextDriverName,
        carNumber: nextCarNumber,
        carModel: nextCarModel,
        updatedById: userId
      },
      update: {
        ...(promoteStage ? { stage: stageToApply } : {}),
        driverName: nextDriverName,
        carNumber: nextCarNumber,
        carModel: nextCarModel,
        updatedById: userId
      }
    });

    if (room.status !== RoomStatus.dispatching) {
      await prisma.room.update({ where: { id: room.id }, data: { status: RoomStatus.dispatching } });
    }

    let settlementHold: Awaited<ReturnType<typeof holdEstimatedFare>> | null = null;
    let settlementHoldError: { code: string; message: string } | null = null;
    const settlementSnapshot = await prisma.room.findUnique({
      where: { id: room.id },
      select: { settlementStatus: true, estimatedFare: true }
    });
    if (
      settlementSnapshot?.settlementStatus === 'pending' &&
      settlementSnapshot.estimatedFare != null
    ) {
      try {
        settlementHold = await holdEstimatedFare(room.id);
      } catch (error: any) {
        settlementHoldError = interpretSettlementError(error);
      }
    }

    const updatedRoom = await loadRoomOrThrow(room.id);
    broadcastRoom(updatedRoom, userId);
    return res.json({
      analysis,
      driver: {
        name: rideState.driverName,
        carModel: rideState.carModel,
        carNumber: rideState.carNumber
      },
      rideState: serializeRideState(rideState),
      room: serializeRoom(updatedRoom, userId),
      settlementHold,
      settlementHoldError
    });
  } catch (error: any) {
    console.error('analyzeDispatchInfo raw error', error);
    if (error?.message === 'INVALID_IMAGE_BASE64' || error?.message === 'IMAGE_BASE64_REQUIRED') {
      return res.status(400).json({ message: 'Invalid or unsupported dispatch screenshot payload' });
    }
    if (
      typeof error?.status === 'number' &&
      error.status >= 400 &&
      error.status < 500 &&
      typeof error?.message === 'string' &&
      error.message.includes('GEMINI_REQUEST_FAILED')
    ) {
      return res
        .status(400)
        .json({ message: error?.geminiMessage || 'Gemini?? ???? ???? ?????. ?? ?????? ??? ???.' });
    }
    if (error?.message === 'GEMINI_API_KEY_NOT_CONFIGURED') {
      return res.status(500).json({ message: 'Gemini API key is not configured.' });
    }
    const isGeminiUnavailable =
      typeof error?.message === 'string' &&
      (error.message.includes('GEMINI_FETCH_FAILED') ||
        (error.message.includes('GEMINI_REQUEST_FAILED') && !error?.status));
    if (isGeminiUnavailable) {
      return res
        .status(502)
        .json({ message: 'Gemini Vision ??? ??????. ?? ? ?? ??? ???.' });
    }
    return res.status(500).json({ message: 'Failed to analyze dispatch screenshot' });
  }
}

function interpretSettlementError(error: any): { code: string; message: string } {
  const code = typeof error?.message === 'string' ? error.message : 'UNKNOWN';
  switch (code) {
    case 'ROOM_NOT_FOUND':
      return { code, message: '방을 찾을 수 없어 정산을 진행하지 못했습니다.' };
    case 'ESTIMATED_FARE_MISSING':
      return { code, message: '예상 요금이 설정되어 있지 않아 예치금을 잡을 수 없습니다.' };
    case 'INSUFFICIENT_BALANCE':
      return { code, message: '일부 참여자의 잔액이 부족해 자동 결제가 실패했습니다.' };
    default:
      return { code, message: '자동 예치금 결제 중 오류가 발생했습니다.' };
  }
}
