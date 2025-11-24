import jwt from 'jsonwebtoken';
<<<<<<< HEAD

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
=======
import { randomUUID } from 'crypto';
import { ENV } from '../config/env';

export type TokenType = 'access' | 'refresh';
export type AppJwtPayload = {
  sub: string;
  loginId: string;
  jti: string;
  type: TokenType;
};
export type SocialPendingPayload = {
  sub: string;
  loginId: string;
  provider: string;
  jti: string;
  type: 'social_pending';
};

const ACCESS_SECRET: jwt.Secret = ENV.JWT_SECRET;
const REFRESH_SECRET: jwt.Secret = ENV.JWT_REFRESH_SECRET;
const SOCIAL_PENDING_SECRET: jwt.Secret = ENV.JWT_SECRET;

const ACCESS_EXPIRES_IN = ENV.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'];
const REFRESH_EXPIRES_IN = ENV.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'];
const SOCIAL_PENDING_EXPIRES_IN = '30m' as jwt.SignOptions['expiresIn'];

type SignResult = {
  token: string;
  payload: AppJwtPayload;
  expiresAt: Date | null;
};

function decodeExpiry(token: string): Date | null {
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (!decoded?.exp) return null;
  return new Date(decoded.exp * 1000);
}

function signToken(type: TokenType, payload: Pick<AppJwtPayload, 'sub' | 'loginId'>): SignResult {
  const jti = randomUUID();
  const tokenPayload: AppJwtPayload = { ...payload, type, jti };
  const secret = type === 'access' ? ACCESS_SECRET : REFRESH_SECRET;
  const expiresIn = type === 'access' ? ACCESS_EXPIRES_IN : REFRESH_EXPIRES_IN;
  const token = jwt.sign(tokenPayload as Record<string, unknown>, secret, { expiresIn });
  return { token, payload: tokenPayload, expiresAt: decodeExpiry(token) };
}

function verifyToken(type: TokenType, token: string): AppJwtPayload {
  const secret = type === 'access' ? ACCESS_SECRET : REFRESH_SECRET;
  const payload = jwt.verify(token, secret) as AppJwtPayload;
  if (payload.type !== type) {
    throw new Error('INVALID_TOKEN_TYPE');
  }
  return payload;
}

export function issueAccessToken(payload: Pick<AppJwtPayload, 'sub' | 'loginId'>) {
  return signToken('access', payload);
}

export function issueRefreshToken(payload: Pick<AppJwtPayload, 'sub' | 'loginId'>) {
  return signToken('refresh', payload);
}

export function verifyAccessJwt(token: string): AppJwtPayload {
  return verifyToken('access', token);
}

export function verifyRefreshJwt(token: string): AppJwtPayload {
  return verifyToken('refresh', token);
}

export function getExpiryDate(token: string): Date | null {
  return decodeExpiry(token);
}

export function issueSocialPendingToken(payload: Pick<SocialPendingPayload, 'sub' | 'loginId' | 'provider'>) {
  const jti = randomUUID();
  const tokenPayload: SocialPendingPayload = { ...payload, jti, type: 'social_pending' };
  const token = jwt.sign(tokenPayload as Record<string, unknown>, SOCIAL_PENDING_SECRET, {
    expiresIn: SOCIAL_PENDING_EXPIRES_IN
  });
  return { token, payload: tokenPayload, expiresAt: decodeExpiry(token) };
}

export function verifySocialPendingToken(token: string): SocialPendingPayload {
  const payload = jwt.verify(token, SOCIAL_PENDING_SECRET) as SocialPendingPayload;
  if (payload.type !== 'social_pending') {
    throw new Error('INVALID_TOKEN_TYPE');
  }
  return payload;
}
>>>>>>> upstream/main
