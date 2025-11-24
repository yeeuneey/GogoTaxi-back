import type { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; windowStart: number };
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // per IP per window
const buckets = new Map<string, Bucket>();

// Simple in-memory rate limiter (per-process). For production, use a shared store.
export function requestLimiter(req: Request, res: Response, next: NextFunction) {
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
