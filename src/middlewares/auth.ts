<<<<<<< HEAD
// src/middlewares/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../lib/jwt';
=======
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessJwt } from '../lib/jwt';
>>>>>>> upstream/main
import type { AppJwtPayload } from '../lib/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: AppJwtPayload;
<<<<<<< HEAD
=======
      userId?: string;
>>>>>>> upstream/main
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
<<<<<<< HEAD
    const payload = verifyJwt(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized: invalid token' });
  }
}
=======
    const payload = verifyAccessJwt(token);
    req.user = payload;
    req.userId = payload.sub;
    next();
  } catch (err: any) {
    const message = err?.message === 'INVALID_TOKEN_TYPE' ? 'Unauthorized: invalid token type' : 'Unauthorized: invalid token';
    return res.status(401).json({ message });
  }
}
>>>>>>> upstream/main
