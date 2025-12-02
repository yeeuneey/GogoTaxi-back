"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.emitRoomUpdate = emitRoomUpdate;
exports.emitRoomClosed = emitRoomClosed;
const socket_io_1 = require("socket.io");
const env_1 = require("../config/env");
let io = null;
function allowedOrigins() {
    return [
        'http://localhost:5173',
        'https://ansangah.github.io'
    ];
}
function roomChannel(roomId) {
    return `room:${roomId}`;
}
function initSocket(server) {
    if (io)
        return io;
    io = new socket_io_1.Server(server, {
        cors: {
            origin: allowedOrigins(),
            credentials: true
        }
    });
    io.on('connection', socket => {
        socket.on('room:subscribe', (roomId) => {
            if (typeof roomId !== 'string' || !roomId.trim())
                return;
            socket.join(roomChannel(roomId));
            socket.emit('room:subscribed', { roomId });
        });
        socket.on('room:unsubscribe', (roomId) => {
            if (typeof roomId !== 'string' || !roomId.trim())
                return;
            socket.leave(roomChannel(roomId));
            socket.emit('room:unsubscribed', { roomId });
        });
    });
    io.engine.on('connection_error', err => {
        if (env_1.ENV.NODE_ENV === 'development') {
            console.error('Socket connection error', err);
        }
    });
    return io;
}
function emitRoomUpdate(roomId, payload) {
    if (!io)
        return;
    io.to(roomChannel(roomId)).emit('room:update', payload);
}
function emitRoomClosed(roomId) {
    if (!io)
        return;
    io.to(roomChannel(roomId)).emit('room:closed', { roomId });
}
