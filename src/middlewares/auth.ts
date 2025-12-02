import type { Request, Response, NextFunction } from 'express';
import { verifyAccessJwt } from '../lib/jwt';
import type { AppJwtPayload } from '../lib/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: AppJwtPayload;
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Prefer Authorization header; fall back to common alternatives to be resilient to front-end omissions.
  const header = req.headers.authorization; // "Bearer <token>"
  const cookieHeader = req.headers.cookie;
  const customHeader = (req.headers['x-access-token'] as string | undefined) ?? undefined;
  const queryToken = (req.query?.token as string | undefined) ?? undefined; // dev fallback

  let token: string | null = null;
  if (header?.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length);
  } else if (customHeader) {
    token = customHeader;
  } else if (cookieHeader) {
    // Minimal cookie parser to avoid an extra dependency.
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(part => {
        const [k, ...rest] = part.trim().split('=');
        return [k, rest.join('=')];
      })
    );
    token = cookies.accessToken || cookies.access_token || null;
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: missing access token' });
  }

  try {
    const payload = verifyAccessJwt(token);
    req.user = payload;
    req.userId = payload.sub;
    next();
  } catch (err: any) {
    const message = err?.message === 'INVALID_TOKEN_TYPE' ? 'Unauthorized: invalid token type' : 'Unauthorized: invalid token';
    return res.status(401).json({ message });
  }
}
