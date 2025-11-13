import jwt from 'jsonwebtoken';

export type AppJwtPayload = { sub: string; email: string };

const SECRET: jwt.Secret = (process.env.JWT_SECRET ?? 'dev') as jwt.Secret;

const RAW = process.env.JWT_EXPIRES_IN ?? '7d';
const EXPIRES_IN: Exclude<jwt.SignOptions['expiresIn'], undefined> =
  /^\d+$/.test(RAW) ? Number(RAW) : (RAW as jwt.SignOptions['expiresIn']) ?? '7d';

export function signJwt(payload: AppJwtPayload): string {
  const opts: jwt.SignOptions = { expiresIn: EXPIRES_IN };
  return jwt.sign(payload as Record<string, unknown>, SECRET, opts);
}

export function verifyJwt<T = AppJwtPayload>(token: string): T {
  return jwt.verify(token, SECRET) as T;
}