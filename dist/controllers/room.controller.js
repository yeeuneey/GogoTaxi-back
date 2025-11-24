"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoom = createRoom;
exports.listRooms = listRooms;
exports.matchRooms = matchRooms;
exports.getRoomDetail = getRoomDetail;
exports.updateRoom = updateRoom;
exports.closeRoom = closeRoom;
exports.joinRoom = joinRoom;
exports.leaveRoom = leaveRoom;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
// 공통 Zod 필드 정의
const decimalField = zod_1.z.coerce.number().refine(Number.isFinite, {
    message: 'Must be a valid number'
});
const isoDateField = zod_1.z.coerce.date();
// 방 생성 요청 스키마
const createRoomSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(50),
    departureLabel: zod_1.z.string().min(1),
    departureLat: decimalField,
    departureLng: decimalField,
    arrivalLabel: zod_1.z.string().min(1),
    arrivalLat: decimalField,
    arrivalLng: decimalField,
    departureTime: isoDateField,
    capacity: zod_1.z.coerce.number().int().min(1).max(6),
    priority: zod_1.z.nativeEnum(client_1.RoomPriority).optional(),
    estimatedFare: zod_1.z.coerce.number().int().positive().optional(),
    estimatedEta: isoDateField.optional()
});
// 방 목록 조회 쿼리 스키마
const listRoomsSchema = zod_1.z
    .object({
    status: zod_1.z.nativeEnum(client_1.RoomStatus).optional(),
    priority: zod_1.z.nativeEnum(client_1.RoomPriority).optional(),
    creatorId: zod_1.z.string().cuid().optional(),
    departureLabel: zod_1.z.string().min(1).optional(),
    hasSeat: zod_1.z.coerce.boolean().optional(),
    mine: zod_1.z.coerce.boolean().optional(),
    sortBy: zod_1.z
        .enum(['default', 'departureDistance', 'arrivalDistance', 'time'])
        .optional(),
    refLat: decimalField.optional(),
    refLng: decimalField.optional(),
    take: zod_1.z.coerce.number().int().min(1).max(50).optional(),
    cursor: zod_1.z.string().cuid().optional()
})
    .refine(data => {
    if (!data.sortBy || data.sortBy === 'default' || data.sortBy === 'time') {
        return true;
    }
    return data.refLat !== undefined && data.refLng !== undefined;
}, {
    message: 'Reference coordinates are required for distance sort',
    path: ['refLat']
});
// URL 파라미터(id)
const roomParamSchema = zod_1.z.object({
    id: zod_1.z.string().cuid()
});
// 방 수정 요청 스키마 (부분 업데이트)
const updateRoomSchema = createRoomSchema.partial().refine(obj => Object.keys(obj).length > 0, {
    message: 'At least one field is required'
});
// 참여 요청 스키마
const joinRoomSchema = zod_1.z.object({
    seatNumber: zod_1.z.coerce.number().int().min(1)
});
// 매칭 API 쿼리 스키마
const matchRoomsSchema = zod_1.z
    .object({
    departureLat: decimalField.optional(),
    departureLng: decimalField.optional(),
    radiusKm: zod_1.z.coerce.number().positive().max(50).optional(),
    earliest: isoDateField.optional(),
    latest: isoDateField.optional(),
    seatsNeeded: zod_1.z.coerce.number().int().min(1).max(6).optional(),
    priority: zod_1.z.nativeEnum(client_1.RoomPriority).optional()
})
    .refine(data => (!data.radiusKm && data.departureLat === undefined && data.departureLng === undefined) ||
    (data.departureLat !== undefined && data.departureLng !== undefined), {
    message: 'Latitude and longitude are required when radius is provided',
    path: ['radiusKm']
});
// Room 조회 시 기본 포함 관계
const defaultRoomInclude = {
    participants: {
        select: {
            id: true,
            userId: true,
            seatNumber: true,
            joinedAt: true,
            user: {
                select: {
                    id: true,
                    email: true,
                    nickname: true
                }
            }
        }
    },
    creator: {
        select: {
            id: true,
            email: true,
            nickname: true
        }
    }
};
const ROOM_STATUS_PROGRESS = {
    [client_1.RoomStatus.open]: { stage: 'recruiting', label: '모집 중' },
    [client_1.RoomStatus.recruiting]: { stage: 'recruiting', label: '모집 중' },
    [client_1.RoomStatus.full]: { stage: 'ready', label: '모집 완료' },
    [client_1.RoomStatus.dispatching]: { stage: 'ready', label: '배차 진행 중' },
    [client_1.RoomStatus.success]: { stage: 'closed', label: '완료' },
    [client_1.RoomStatus.failed]: { stage: 'closed', label: '실패' },
    [client_1.RoomStatus.closed]: { stage: 'closed', label: '마감' }
};
// 공통 validation 응답
function respondValidationError(res, error) {
    return res.status(400).json({
        message: 'Validation failed',
        issues: error.issues
    });
}
const toDecimal = (value) => new client_1.Prisma.Decimal(value);
// Room JSON 직렬화
function serializeRoom(room, viewerId) {
    const progress = ROOM_STATUS_PROGRESS[room.status];
    const filledSeats = room.participants.length;
    const seatsAvailable = Math.max(room.capacity - filledSeats, 0);
    const serialized = {
        ...room,
        departureLat: room.departureLat.toNumber(),
        departureLng: room.departureLng.toNumber(),
        arrivalLat: room.arrivalLat.toNumber(),
        arrivalLng: room.arrivalLng.toNumber(),
        estimatedFare: room.estimatedFare ?? null,
        estimatedEta: room.estimatedEta?.toISOString() ?? null,
        departureTime: room.departureTime.toISOString(),
        createdAt: room.createdAt.toISOString(),
        participants: room.participants,
        creator: room.creator,
        seats: seatsAvailable,
        filled: filledSeats,
        dispatchStage: progress.stage,
        dispatchStageLabel: progress.label
    };
    if (!viewerId) {
        return serialized;
    }
    const seatNumber = room.participants.find(participant => participant.userId === viewerId)?.seatNumber ?? null;
    return {
        ...serialized,
        mySeatNumber: seatNumber,
        dispatchStage: progress.stage,
        dispatchStageLabel: progress.label
    };
}
// 거리 계산 (위도/경도 → km)
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
/**
 * 방 상태 전환(open ↔ full) 보조 함수
 * - 참가자 수에 따라 open / full 자동 업데이트
 * - closed 방은 건드리지 않음
 */
async function refreshRoomStatus(roomId) {
    const snapshot = await prisma_1.prisma.room.findUnique({
        where: { id: roomId },
        select: {
            id: true,
            capacity: true,
            status: true,
            participants: { select: { id: true } }
        }
    });
    if (!snapshot)
        return;
    if (snapshot.status === client_1.RoomStatus.closed)
        return;
    const nextStatus = snapshot.participants.length >= snapshot.capacity ? client_1.RoomStatus.full : client_1.RoomStatus.open;
    if (snapshot.status !== nextStatus) {
        await prisma_1.prisma.room.update({ where: { id: roomId }, data: { status: nextStatus } });
    }
}
// Room 로드 + 없으면 예외
async function loadRoomOrThrow(id) {
    const room = await prisma_1.prisma.room.findUnique({
        where: { id },
        include: defaultRoomInclude
    });
    if (!room) {
        throw new Error('ROOM_NOT_FOUND');
    }
    return room;
}
/**
 * 방 생성
 * - host(creator)를 seatNumber=1 로 자동 참가시킴
 * - 초기 status는 open (Prisma default) 가정
 */
async function createRoom(req, res) {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
        return respondValidationError(res, parsed.error);
    }
    const payload = parsed.data;
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const room = await prisma_1.prisma.room.create({
            data: {
                title: payload.title,
                creatorId: userId,
                departureLabel: payload.departureLabel,
                departureLat: toDecimal(payload.departureLat),
                departureLng: toDecimal(payload.departureLng),
                arrivalLabel: payload.arrivalLabel,
                arrivalLat: toDecimal(payload.arrivalLat),
                arrivalLng: toDecimal(payload.arrivalLng),
                departureTime: payload.departureTime,
                capacity: payload.capacity,
                priority: payload.priority ?? client_1.RoomPriority.time,
                estimatedFare: payload.estimatedFare ?? null,
                estimatedEta: payload.estimatedEta ?? null,
                participants: {
                    create: {
                        userId,
                        seatNumber: 1
                    }
                }
            },
            include: defaultRoomInclude
        });
        await refreshRoomStatus(room.id);
        const updated = await loadRoomOrThrow(room.id);
        return res.status(201).json({ room: serializeRoom(updated, userId) });
    }
    catch (error) {
        console.error('createRoom error', error);
        return res.status(500).json({ message: 'Failed to create room' });
    }
}
/**
 * 방 목록 조회
 * - status, priority, creatorId 필터
 * - cursor 기반 페이징
 */
async function listRooms(req, res) {
    const parsed = listRoomsSchema.safeParse(req.query);
    if (!parsed.success) {
        return respondValidationError(res, parsed.error);
    }
    const userId = req.user?.sub;
    const { status, priority, creatorId, departureLabel, hasSeat, mine, sortBy = 'default', refLat, refLng, take = 20, cursor } = parsed.data;
    const includeMine = mine ?? (!!creatorId && userId === creatorId);
    const where = {
        ...(priority ? { priority } : {}),
        ...(!includeMine && creatorId ? { creatorId } : {}),
        ...(departureLabel
            ? {
                departureLabel: {
                    contains: departureLabel,
                    mode: 'insensitive'
                }
            }
            : {})
    };
    const effectiveStatus = status ?? (hasSeat ? client_1.RoomStatus.open : undefined);
    if (effectiveStatus) {
        where.status = effectiveStatus;
    }
    if (includeMine) {
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        where.OR = [
            { creatorId: userId },
            {
                participants: {
                    some: {
                        userId
                    }
                }
            }
        ];
    }
    try {
        const rooms = await prisma_1.prisma.room.findMany({
            where,
            include: defaultRoomInclude,
            orderBy: { departureTime: 'asc' },
            take,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
        });
        let sortedRooms = rooms;
        if (sortBy === 'departureDistance' && refLat !== undefined && refLng !== undefined) {
            sortedRooms = [...rooms].sort((a, b) => {
                const distA = haversineKm(refLat, refLng, a.departureLat.toNumber(), a.departureLng.toNumber());
                const distB = haversineKm(refLat, refLng, b.departureLat.toNumber(), b.departureLng.toNumber());
                return distA - distB;
            });
        }
        else if (sortBy === 'arrivalDistance' && refLat !== undefined && refLng !== undefined) {
            sortedRooms = [...rooms].sort((a, b) => {
                const distA = haversineKm(refLat, refLng, a.arrivalLat.toNumber(), a.arrivalLng.toNumber());
                const distB = haversineKm(refLat, refLng, b.arrivalLat.toNumber(), b.arrivalLng.toNumber());
                return distA - distB;
            });
        }
        else if (sortBy === 'time') {
            sortedRooms = [...rooms].sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());
        }
        return res.json({
            rooms: sortedRooms.map(room => serializeRoom(room, userId))
        });
    }
    catch (error) {
        console.error('listRooms error', error);
        return res.status(500).json({ message: 'Failed to load rooms' });
    }
}
/**
 * 매칭 API
 * - 위치(위도/경도 + 반경)
 * - 시간(earliest ~ latest)
 * - seatsNeeded(필요 좌석 수)
 * - priority
 * - DB에서 1차 필터 → 메모리에서 거리/잔여좌석 2차 필터
 */
async function matchRooms(req, res) {
    const parsed = matchRoomsSchema.safeParse(req.query);
    if (!parsed.success) {
        return respondValidationError(res, parsed.error);
    }
    const userId = req.user?.sub;
    const { departureLat, departureLng, radiusKm = 3, earliest, latest, seatsNeeded = 1, priority } = parsed.data;
    const where = {
        status: client_1.RoomStatus.open
    };
    if (priority) {
        where.priority = priority;
    }
    if (earliest || latest) {
        where.departureTime = {};
        if (earliest) {
            where.departureTime.gte = earliest;
        }
        if (latest) {
            where.departureTime.lte = latest;
        }
    }
    // 대략적인 bounding box 필터
    if (departureLat !== undefined && departureLng !== undefined) {
        const latDelta = radiusKm / 111;
        const latMin = departureLat - latDelta;
        const latMax = departureLat + latDelta;
        const lngDelta = radiusKm / (111 * Math.max(Math.cos((departureLat * Math.PI) / 180), 0.0001));
        const lngMin = departureLng - lngDelta;
        const lngMax = departureLng + lngDelta;
        where.departureLat = { gte: toDecimal(latMin), lte: toDecimal(latMax) };
        where.departureLng = { gte: toDecimal(lngMin), lte: toDecimal(lngMax) };
    }
    try {
        const rooms = await prisma_1.prisma.room.findMany({
            where,
            include: defaultRoomInclude,
            orderBy: { departureTime: 'asc' }
        });
        const filtered = rooms.filter(room => {
            const seatsAvailable = room.capacity - room.participants.length;
            if (seatsAvailable < seatsNeeded)
                return false;
            if (departureLat !== undefined && departureLng !== undefined) {
                const distance = haversineKm(departureLat, departureLng, room.departureLat.toNumber(), room.departureLng.toNumber());
                if (distance > radiusKm)
                    return false;
            }
            return true;
        });
        return res.json({ rooms: filtered.map(room => serializeRoom(room, userId)) });
    }
    catch (error) {
        console.error('matchRooms error', error);
        return res.status(500).json({ message: 'Failed to match rooms' });
    }
}
/**
 * 방 상세 조회
 */
async function getRoomDetail(req, res) {
    const parsed = roomParamSchema.safeParse(req.params);
    if (!parsed.success) {
        return respondValidationError(res, parsed.error);
    }
    const userId = req.user?.sub;
    try {
        const room = await prisma_1.prisma.room.findUnique({
            where: { id: parsed.data.id },
            include: defaultRoomInclude
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        return res.json({ room: serializeRoom(room, userId) });
    }
    catch (error) {
        console.error('getRoomDetail error', error);
        return res.status(500).json({ message: 'Failed to load room detail' });
    }
}
/**
 * 방 수정 (host + open 상태일 때만 허용)
 */
async function updateRoom(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return respondValidationError(res, param.error);
    }
    const body = updateRoomSchema.safeParse(req.body);
    if (!body.success) {
        return respondValidationError(res, body.error);
    }
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const room = await prisma_1.prisma.room.findUnique({
            where: { id: param.data.id }
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        if (room.creatorId !== userId) {
            return res.status(403).json({ message: 'Only host can update room' });
        }
        if (room.status !== client_1.RoomStatus.open) {
            return res.status(400).json({ message: 'Only open rooms can be updated' });
        }
        const data = {};
        const payload = body.data;
        if (payload.title !== undefined)
            data.title = payload.title;
        if (payload.departureLabel !== undefined)
            data.departureLabel = payload.departureLabel;
        if (payload.departureLat !== undefined)
            data.departureLat = toDecimal(payload.departureLat);
        if (payload.departureLng !== undefined)
            data.departureLng = toDecimal(payload.departureLng);
        if (payload.arrivalLabel !== undefined)
            data.arrivalLabel = payload.arrivalLabel;
        if (payload.arrivalLat !== undefined)
            data.arrivalLat = toDecimal(payload.arrivalLat);
        if (payload.arrivalLng !== undefined)
            data.arrivalLng = toDecimal(payload.arrivalLng);
        if (payload.departureTime !== undefined)
            data.departureTime = payload.departureTime;
        if (payload.capacity !== undefined)
            data.capacity = payload.capacity;
        if (payload.priority !== undefined)
            data.priority = payload.priority;
        if (payload.estimatedFare !== undefined)
            data.estimatedFare = payload.estimatedFare;
        if (payload.estimatedEta !== undefined)
            data.estimatedEta = payload.estimatedEta;
        const updated = await prisma_1.prisma.room.update({
            where: { id: room.id },
            data,
            include: defaultRoomInclude
        });
        return res.json({ room: serializeRoom(updated, userId) });
    }
    catch (error) {
        console.error('updateRoom error', error);
        return res.status(500).json({ message: 'Failed to update room' });
    }
}
/**
 * 방 닫기 (open/full → closed)
 * - host만 가능
 */
async function closeRoom(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return respondValidationError(res, param.error);
    }
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const room = await prisma_1.prisma.room.findUnique({
            where: { id: param.data.id }
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        if (room.creatorId !== userId) {
            return res.status(403).json({ message: 'Only host can close room' });
        }
        if (room.status === client_1.RoomStatus.closed) {
            return res.status(400).json({ message: 'Room already closed' });
        }
        const updated = await prisma_1.prisma.room.update({
            where: { id: room.id },
            data: { status: client_1.RoomStatus.closed },
            include: defaultRoomInclude
        });
        return res.json({ room: serializeRoom(updated, userId) });
    }
    catch (error) {
        console.error('closeRoom error', error);
        return res.status(500).json({ message: 'Failed to close room' });
    }
}
/**
 * 방 참여 (좌석 선택)
 */
async function joinRoom(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return respondValidationError(res, param.error);
    }
    const body = joinRoomSchema.safeParse(req.body);
    if (!body.success) {
        return respondValidationError(res, body.error);
    }
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const room = await prisma_1.prisma.room.findUnique({
            where: { id: param.data.id },
            include: {
                participants: true
            }
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        if (room.status !== client_1.RoomStatus.open) {
            return res.status(400).json({ message: 'Room is not open for joining' });
        }
        if (room.participants.some(p => p.userId === userId)) {
            return res.status(400).json({ message: 'Already joined this room' });
        }
        const seatNumber = body.data.seatNumber;
        if (seatNumber > room.capacity) {
            return res.status(400).json({ message: 'Seat number exceeds room capacity' });
        }
        if (room.participants.some(p => p.seatNumber === seatNumber)) {
            return res.status(409).json({ message: 'Seat already taken' });
        }
        await prisma_1.prisma.roomParticipant.create({
            data: {
                roomId: room.id,
                userId,
                seatNumber
            }
        });
        await refreshRoomStatus(room.id);
        const updated = await loadRoomOrThrow(room.id);
        return res.status(201).json({ room: serializeRoom(updated, userId) });
    }
    catch (error) {
        console.error('joinRoom error', error);
        if (error.message === 'ROOM_NOT_FOUND') {
            return res.status(404).json({ message: 'Room not found' });
        }
        return res.status(500).json({ message: 'Failed to join room' });
    }
}
/**
 * 방 참여 취소 (leave)
 */
async function leaveRoom(req, res) {
    const param = roomParamSchema.safeParse(req.params);
    if (!param.success) {
        return respondValidationError(res, param.error);
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
                status: true
            }
        });
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        if (room.creatorId === userId) {
            return res.status(403).json({ message: 'Host cannot leave their own room' });
        }
        const participant = await prisma_1.prisma.roomParticipant.findFirst({
            where: { roomId: param.data.id, userId }
        });
        if (!participant) {
            return res.status(404).json({ message: 'Not participating in this room' });
        }
        await prisma_1.prisma.roomParticipant.delete({ where: { id: participant.id } });
        await refreshRoomStatus(param.data.id);
        const updated = await prisma_1.prisma.room.findUnique({
            where: { id: param.data.id },
            include: defaultRoomInclude
        });
        return res.json({ room: updated ? serializeRoom(updated, userId) : null });
    }
    catch (error) {
        console.error('leaveRoom error', error);
        if (error.message === 'ROOM_NOT_FOUND') {
            return res.status(404).json({ message: 'Room not found' });
        }
        return res.status(500).json({ message: 'Failed to leave room' });
    }
}
