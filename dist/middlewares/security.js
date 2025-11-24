"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLimiter = requestLimiter;
const WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS = 120; // per IP per window
const buckets = new Map();
// Simple in-memory rate limiter (per-process). For production, use a shared store.
function requestLimiter(req, res, next) {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > WINDOW_MS) {
        buckets.set(key, { count: 1, windowStart: now });
        return next();
    }
    if (bucket.count >= MAX_REQUESTS) {
        return res.status(429).json({ message: 'Too many requests, slow down.' });
    }
    bucket.count += 1;
    return next();
}
// Lightweight cleanup to avoid unbounded memory.
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
        if (now - bucket.windowStart > WINDOW_MS * 5) {
            buckets.delete(key);
        }
    }
}, WINDOW_MS).unref();
