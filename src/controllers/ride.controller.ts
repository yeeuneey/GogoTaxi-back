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
