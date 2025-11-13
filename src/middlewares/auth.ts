// src/middlewares/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../lib/jwt';
import type { AppJwtPayload } from '../lib/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: AppJwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization; // "Bearer <token>"
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: missing Bearer token' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyJwt(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized: invalid token' });
  }
}