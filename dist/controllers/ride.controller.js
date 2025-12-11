"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUberDeeplink = createUberDeeplink;
exports.getRoomRideState = getRoomRideState;
exports.requestRoomUberRide = requestRoomUberRide;
exports.updateRideStage = updateRideStage;
exports.analyzeDispatchInfo = analyzeDispatchInfo;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const env_1 = require("../config/env");
const prisma_1 = require("../lib/prisma");
const room_controller_1 = require("./room.controller");
const dispatchVisionService_1 = require("../modules/ride/dispatchVisionService");
const service_1 = require("../modules/settlement/service");
const uberDeeplinkSchema = zod_1.z
    .object({
    pickupLat: zod_1.z.coerce.number(),
    pickupLng: zod_1.z.coerce.number(),
    pickupLabel: zod_1.z.string().min(1).optional(),
    pickupNickname: zod_1.z.string().min(1).optional(),
    dropoffLat: zod_1.z.coerce.number(),
    dropoffLng: zod_1.z.coerce.number(),
    dropoffLabel: zod_1.z.string().min(1).optional(),
    dropoffNickname: zod_1.z.string().min(1).optional(),
    productId: zod_1.z.string().min(1).optional(),
    pickupTime: zod_1.z.coerce.date().optional(),
    note: zod_1.z.string().max(200).optional()
})
    .refine(data => Number.isFinite(data.pickupLat) && Number.isFinite(data.pickupLng), {
    message: 'Pickup coordinates are required',
    path: ['pickupLat']
})
    .refine(data => Number.isFinite(data.dropoffLat) && Number.isFinite(data.dropoffLng), {
    message: 'Dropoff coordinates are required',
    path: ['dropoffLat']
});
const rideStageUpdateSchema = zod_1.z.object({
    stage: zod_1.z.nativeEnum(client_1.RoomRideStage),
    note: zod_1.z.string().max(200).optional(),
    driverName: zod_1.z.string().max(100).optional(),
    carModel: zod_1.z.string().max(100).optional(),
    carNumber: zod_1.z.string().max(50).optional()
});
const dispatchScreenshotSchema = zod_1.z.object({
    imageBase64: zod_1.z.string().min(20, 'imageBase64 is required'),
    mimeType: zod_1.z.string().optional(),
    prompt: zod_1.z.string().optional()
});
const roomParamSchema = zod_1.z.object({ id: zod_1.z.string().cuid() });
const toDecimal = (value) => new client_1.Prisma.Decimal(value);
const DEFAULT_UBER_CLIENT_ID = 'gogotaxi-demo';
function buildUberDeeplinkUrls(payload) {
    const clientId = env_1.ENV.UBER_CLIENT_ID || DEFAULT_UBER_CLIENT_ID;
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
function allowedNextStages(current) {
    const transitions = {
        [client_1.RoomRideStage.idle]: [client_1.RoomRideStage.requesting, client_1.RoomRideStage.deeplink_ready],
        [client_1.RoomRideStage.requesting]: [client_1.RoomRideStage.deeplink_ready, client_1.RoomRideStage.dispatching],
        [client_1.RoomRideStage.deeplink_ready]: [client_1.RoomRideStage.dispatching, client_1.RoomRideStage.canceled],
        [client_1.RoomRideStage.dispatching]: [client_1.RoomRideStage.driver_assigned, client_1.RoomRideStage.canceled],
        [client_1.RoomRideStage.driver_assigned]: [client_1.RoomRideStage.arriving, client_1.RoomRideStage.canceled],
        [client_1.RoomRideStage.arriving]: [client_1.RoomRideStage.onboard, client_1.RoomRideStage.canceled],
        [client_1.RoomRideStage.onboard]: [client_1.RoomRideStage.completed, client_1.RoomRideStage.canceled],
        [client_1.RoomRideStage.completed]: [],
        [client_1.RoomRideStage.canceled]: []
    };
    return transitions[current] ?? [];
}
function createUberDeeplink(req, res) {
    const merged = { ...req.query, ...req.body };
    const parsed = uberDeeplinkSchema.safeParse(merged);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', issues: parsed.error.issues });
    }
    const payload = parsed.data;
    const deeplinks = buildUberDeeplinkUrls(payload);
    return res.json({ url: deeplinks.web, appUrl: deeplinks.app });
}
async function getRoomRideState(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
    }
    try {
        const rideState = await prisma_1.prisma.roomRideState.findUnique({ where: { roomId: param.data.id } });
        return res.json({ rideState: (0, room_controller_1.serializeRideState)(rideState) });
    }
    catch (error) {
        console.error('getRoomRideState error', error);
        return res.status(500).json({ message: 'Failed to load ride state' });
    }
}
async function requestRoomUberRide(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
    }
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        // Load room early so we can supply missing pickup/dropoff data from the room itself.
        const room = await prisma_1.prisma.room.findUnique({
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
        const merged = { ...req.query, ...req.body };
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
        const rideState = await prisma_1.prisma.roomRideState.upsert({
            where: { roomId: room.id },
            create: {
                roomId: room.id,
                stage: client_1.RoomRideStage.requesting,
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
                stage: client_1.RoomRideStage.requesting,
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
        if (room.status !== client_1.RoomStatus.dispatching) {
            await prisma_1.prisma.room.update({ where: { id: room.id }, data: { status: client_1.RoomStatus.dispatching } });
        }
        const updatedRoom = await (0, room_controller_1.loadRoomOrThrow)(room.id);
        (0, room_controller_1.broadcastRoom)(updatedRoom, userId);
        return res.status(201).json({
            rideState: (0, room_controller_1.serializeRideState)(rideState),
            room: (0, room_controller_1.serializeRoom)(updatedRoom, userId),
            url: deeplinks.web,
            appUrl: deeplinks.app
        });
    }
    catch (error) {
        console.error('requestRoomUberRide error', error);
        return res.status(500).json({ message: 'Failed to request Uber ride' });
    }
}
async function updateRideStage(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
    }
    const body = rideStageUpdateSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ message: 'Validation failed', issues: body.error.issues });
    }
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const room = await prisma_1.prisma.room.findUnique({
            where: { id: param.data.id },
            select: { id: true, creatorId: true }
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        if (room.creatorId !== userId) {
            return res.status(403).json({ message: '호스트만 배차 단계를 변경할 수 있습니다.' });
        }
        const current = await prisma_1.prisma.roomRideState.upsert({
            where: { roomId: room.id },
            create: { roomId: room.id, stage: client_1.RoomRideStage.idle },
            update: {}
        });
        const allowed = allowedNextStages(current.stage);
        if (current.stage !== body.data.stage && !allowed.includes(body.data.stage)) {
            return res.status(400).json({ message: '해당 단계로 전환할 수 없습니다.', current: current.stage });
        }
        const rideState = await prisma_1.prisma.roomRideState.update({
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
        if (body.data.stage === client_1.RoomRideStage.completed) {
            await prisma_1.prisma.room.update({ where: { id: room.id }, data: { status: client_1.RoomStatus.success } });
        }
        else if (body.data.stage === client_1.RoomRideStage.canceled) {
            await prisma_1.prisma.room.update({ where: { id: room.id }, data: { status: client_1.RoomStatus.failed } });
        }
        const updatedRoom = await prisma_1.prisma.room.findUnique({
            where: { id: room.id },
            include: room_controller_1.defaultRoomInclude
        });
        if (!updatedRoom) {
            return res.status(404).json({ message: 'Room not found after update' });
        }
        (0, room_controller_1.broadcastRoom)(updatedRoom, userId);
        return res.json({ rideState: (0, room_controller_1.serializeRideState)(rideState), room: (0, room_controller_1.serializeRoom)(updatedRoom, userId) });
    }
    catch (error) {
        console.error('updateRideStage error', error);
        return res.status(500).json({ message: 'Failed to update ride stage' });
    }
}
const PROMOTABLE_STAGES = new Set([
    client_1.RoomRideStage.idle,
    client_1.RoomRideStage.requesting,
    client_1.RoomRideStage.deeplink_ready,
    client_1.RoomRideStage.dispatching
]);
function normalizePipe(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed.length ? trimmed : null;
}
async function analyzeDispatchInfo(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return res.status(400).json({ message: 'Validation failed', issues: param.error.issues });
    }
    const body = dispatchScreenshotSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ message: 'Validation failed', issues: body.error.issues });
    }
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const room = await prisma_1.prisma.room.findUnique({
            where: { id: param.data.id },
            select: {
                id: true,
                creatorId: true,
                status: true,
                settlementStatus: true,
                estimatedFare: true
            }
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        if (room.creatorId !== userId) {
            return res.status(403).json({ message: '호스트만 배차 정보를 업데이트할 수 있습니다.' });
        }
        const analysis = await (0, dispatchVisionService_1.analyzeDispatchScreenshot)(body.data);
        const normalizedDriver = normalizePipe(analysis.driverName);
        const normalizedCarNumber = normalizePipe(analysis.carNumber);
        const normalizedCarModel = normalizePipe(analysis.carModel);
        const currentRideState = await prisma_1.prisma.roomRideState.findUnique({
            where: { roomId: room.id }
        });
        const promoteStage = !currentRideState || PROMOTABLE_STAGES.has(currentRideState.stage ?? client_1.RoomRideStage.idle);
        const stageToApply = promoteStage
            ? client_1.RoomRideStage.driver_assigned
            : currentRideState?.stage ?? client_1.RoomRideStage.idle;
        const nextDriverName = normalizedDriver ?? currentRideState?.driverName ?? null;
        const nextCarNumber = normalizedCarNumber ?? currentRideState?.carNumber ?? null;
        const nextCarModel = normalizedCarModel ?? currentRideState?.carModel ?? null;
        const rideState = await prisma_1.prisma.roomRideState.upsert({
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
        if (room.status !== client_1.RoomStatus.dispatching) {
            await prisma_1.prisma.room.update({ where: { id: room.id }, data: { status: client_1.RoomStatus.dispatching } });
        }
        let settlementHold = null;
        let settlementHoldError = null;
        const settlementSnapshot = await prisma_1.prisma.room.findUnique({
            where: { id: room.id },
            select: { settlementStatus: true, estimatedFare: true }
        });
        if (settlementSnapshot?.settlementStatus === 'pending' &&
            settlementSnapshot.estimatedFare != null) {
            try {
                settlementHold = await (0, service_1.holdEstimatedFare)(room.id);
            }
            catch (error) {
                settlementHoldError = interpretSettlementError(error);
            }
        }
        const updatedRoom = await (0, room_controller_1.loadRoomOrThrow)(room.id);
        (0, room_controller_1.broadcastRoom)(updatedRoom, userId);
        return res.json({
            analysis,
            driver: {
                name: rideState.driverName,
                carModel: rideState.carModel,
                carNumber: rideState.carNumber
            },
            rideState: (0, room_controller_1.serializeRideState)(rideState),
            room: (0, room_controller_1.serializeRoom)(updatedRoom, userId),
            settlementHold,
            settlementHoldError
        });
    }
    catch (error) {
        console.error('analyzeDispatchInfo raw error', error);
        if (error?.message === 'INVALID_IMAGE_BASE64' || error?.message === 'IMAGE_BASE64_REQUIRED') {
            return res.status(400).json({ message: 'Invalid or unsupported dispatch screenshot payload' });
        }
        if (typeof error?.status === 'number' &&
            error.status >= 400 &&
            error.status < 500 &&
            typeof error?.message === 'string' &&
            error.message.includes('GEMINI_REQUEST_FAILED')) {
            return res
                .status(400)
                .json({ message: error?.geminiMessage || 'Gemini?? ???? ???? ?????. ?? ?????? ??? ???.' });
        }
        if (error?.message === 'GEMINI_API_KEY_NOT_CONFIGURED') {
            return res.status(500).json({ message: 'Gemini API key is not configured.' });
        }
        const isGeminiUnavailable = typeof error?.message === 'string' &&
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
function interpretSettlementError(error) {
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
