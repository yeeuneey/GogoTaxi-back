import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { ENV } from '../config/env';

let io: Server | null = null;

function allowedOrigins() {
  return [
    'http://localhost:5173',
    'https://ansangah.github.io'
  ];
}

function roomChannel(roomId: string) {
  return `room:${roomId}`;
}

export function initSocket(server: HttpServer) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: allowedOrigins(),
      credentials: true
    }
  });

  io.on('connection', socket => {
    socket.on('room:subscribe', (roomId: unknown) => {
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      socket.join(roomChannel(roomId));
      socket.emit('room:subscribed', { roomId });
    });

    socket.on('room:join', (roomId: unknown) => {
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      socket.join(roomChannel(roomId));
      socket.emit('room:subscribed', { roomId });
    });

    socket.on('room:unsubscribe', (roomId: unknown) => {
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      socket.leave(roomChannel(roomId));
      socket.emit('room:unsubscribed', { roomId });
    });

    socket.on('room:leave', (roomId: unknown) => {
      if (typeof roomId !== 'string' || !roomId.trim()) return;
      socket.leave(roomChannel(roomId));
      socket.emit('room:unsubscribed', { roomId });
    });
  });

  io.engine.on('connection_error', err => {
    if (ENV.NODE_ENV === 'development') {
      console.error('Socket connection error', err);
    }
  });

  return io;
}

export function emitRoomUpdate(roomId: string, payload: unknown) {
  if (!io) return;
  io.to(roomChannel(roomId)).emit('room:update', payload);
}

export function emitRoomClosed(roomId: string) {
  if (!io) return;
  io.to(roomChannel(roomId)).emit('room:closed', { roomId });
}

export function emitRoomsRefresh(payload: { roomId?: string | null; reason?: string }) {
  if (!io) return;
  io.emit('rooms:refresh', {
    roomId: payload.roomId ?? null,
    reason: payload.reason ?? 'changed',
    at: new Date().toISOString()
  });
}
