import { Router } from 'express';
import { z } from 'zod';
import { SignUpDto, LoginDto, RefreshTokenDto, SocialLoginDto, SocialConsentDto } from './dto';
import { prisma } from '../../lib/prisma';
import { signUp, login, refreshTokens, logout, socialLogin, completeSocialConsent } from './service';
import { ENV } from '../../config/env';

function extractPayload(reqBody: any, fallback: Record<string, any> = {}) {
  if (reqBody && typeof reqBody === 'object' && !Buffer.isBuffer(reqBody)) {
    return reqBody;
  }
  if (typeof reqBody === 'string') {
    const trimmed = reqBody.trim();
    if (trimmed) {
      try {
        return JSON.parse(trimmed);
      } catch (_error) {
        return fallback;
      }
    }
  }
  return fallback;
}

export const authRouter = Router();

const parseRequestMeta = (req: any) => ({
  userAgent: req.get?.('user-agent') ?? undefined,
  ip: (typeof req.ip === 'string' ? req.ip : undefined) ?? req.socket?.remoteAddress ?? undefined
});

const LoginIdCheckDto = z.object({
  loginId: z.string().min(4).max(30)
});

authRouter.post('/signup', async (req, res) => {
  try {
    const payload = extractPayload(req.body, req.query as Record<string, any>);
    const input = SignUpDto.parse(req.body);
    const result = await signUp(input, parseRequestMeta(req));
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.message === 'LOGIN_ID_TAKEN') return res.status(409).json({ message: 'Login ID already in use' });
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.get('/check-id', async (req, res) => {
  try {
    const input = LoginIdCheckDto.parse({ loginId: req.query.loginId });
    const existing = await prisma.user.findUnique({ where: { loginId: input.loginId } });
    return res.json({ loginId: input.loginId, available: !existing });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const payload = extractPayload(req.body, req.query as Record<string, any>);
    const input = LoginDto.parse(req.body);
    const result = await login(input, parseRequestMeta(req));
    res.json(result);
  } catch (e: any) {
    if (e?.message === 'INVALID_CREDENTIALS') return res.status(401).json({ message: 'Invalid ID or password' });
    if (e?.name === 'ZodError') {
      // Debug log to surface bad payloads from the client
      console.error('login validation failed', { issues: e.issues, body: req.body });
      return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    }
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const input = RefreshTokenDto.parse(req.body);
    const result = await refreshTokens(input, parseRequestMeta(req));
    res.json(result);
  } catch (e: any) {
    if (e?.message === 'INVALID_REFRESH' || e?.message === 'INVALID_TOKEN_TYPE') {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.post('/logout', async (req, res) => {
  try {
    const input = RefreshTokenDto.parse(req.body);
    await logout(input);
    res.json({ success: true });
  } catch (e: any) {
    if (e?.message === 'INVALID_REFRESH' || e?.message === 'INVALID_TOKEN_TYPE') {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

// Convenience alias to fetch profile via /auth/me for clients expecting that path.
authRouter.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: missing access token' });
    }
    // reuse existing /me route logic via request to getProfile
    const { getProfile } = await import('./service');
    const { verifyAccessJwt } = await import('../../lib/jwt');
    const payload = verifyAccessJwt(authHeader.slice('Bearer '.length));
    const me = await getProfile(payload.sub);
    return res.json({ me });
  } catch (e: any) {
    if (e?.message === 'USER_NOT_FOUND') return res.status(404).json({ message: 'User not found' });
    if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Unauthorized: invalid token' });
    }
    console.error(e);
    return res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.get('/social/kakao/start', (req, res) => {
  if (!ENV.KAKAO_REST_API_KEY || !ENV.KAKAO_REDIRECT_URI) {
    return res.status(500).json({ message: 'Kakao OAuth not configured on server' });
  }
  const url = new URL('https://kauth.kakao.com/oauth/authorize');
  url.searchParams.set('client_id', ENV.KAKAO_REST_API_KEY);
  url.searchParams.set('redirect_uri', ENV.KAKAO_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

authRouter.get('/social/kakao/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (!code) return res.status(400).json({ message: 'Missing authorization code' });

  try {
    const result = await socialLogin(
      { provider: 'kakao', code, redirectUri: ENV.KAKAO_REDIRECT_URI },
      parseRequestMeta(req)
    );

    if (result.status === 'needs_consent') {
      const target = ENV.SOCIAL_CONSENT_REDIRECT_URI || 'http://localhost:5173/social-consent';
      const url = new URL(target);
      url.searchParams.set('pendingToken', result.pendingToken);
      url.searchParams.set('provider', result.provider);
      if (result.profileName) url.searchParams.set('name', result.profileName);
      if (state) url.searchParams.set('redirect', state);
      return res.redirect(url.toString());
    }

    const successTarget = ENV.SOCIAL_LOGIN_SUCCESS_REDIRECT_URI || 'http://localhost:5173/home';
    const url = new URL(successTarget);
    if (state) url.searchParams.set('redirect', state);
    url.searchParams.set('provider', 'kakao');
    url.searchParams.set('accessToken', result.accessToken);
    if (result.refreshToken) url.searchParams.set('refreshToken', result.refreshToken);
    return res.redirect(url.toString());
  } catch (e: any) {
    if (
      ['KAKAO_PROFILE_MISSING', 'KAKAO_TOKEN_EXCHANGE_FAILED'].includes(e?.message) ||
      ['KAKAO_ACCESS_TOKEN_REQUIRED'].includes(e?.message)
    ) {
      return res.status(401).json({ message: 'Invalid or expired social token' });
    }
    if (e?.message === 'KAKAO_OAUTH_NOT_CONFIGURED') {
      return res.status(500).json({ message: 'Kakao OAuth not configured on server' });
    }
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.post('/social/login', async (req, res) => {
  try {
    const input = SocialLoginDto.parse(req.body);
    const result = await socialLogin(input, parseRequestMeta(req));
    res.json(result);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (
      ['KAKAO_PROFILE_MISSING', 'GOOGLE_PROFILE_MISSING', 'GOOGLE_TOKEN_EXCHANGE_FAILED', 'KAKAO_TOKEN_EXCHANGE_FAILED'].includes(
        e?.message
      )
    ) {
      return res.status(401).json({ message: 'Invalid or expired social token' });
    }
    if (['KAKAO_ACCESS_TOKEN_REQUIRED', 'GOOGLE_TOKEN_REQUIRED'].includes(e?.message)) {
      return res.status(400).json({ message: 'Missing social login token' });
    }
    if (e?.message === 'GOOGLE_OAUTH_NOT_CONFIGURED') {
      return res.status(500).json({ message: 'Google OAuth not configured on server' });
    }
    if (e?.message === 'KAKAO_OAUTH_NOT_CONFIGURED') {
      return res.status(500).json({ message: 'Kakao OAuth not configured on server' });
    }
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

authRouter.post('/social/consent', async (req, res) => {
  try {
    const input = SocialConsentDto.parse(req.body);
    const session = await completeSocialConsent(input, parseRequestMeta(req));
    res.json(session);
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    if (['INVALID_TOKEN_TYPE', 'SOCIAL_CONSENT_REQUIRED'].includes(e?.message) || ['TokenExpiredError', 'JsonWebTokenError'].includes(e?.name)) {
      return res.status(401).json({ message: 'Invalid or expired pending token' });
    }
    if (e?.message === 'USER_NOT_FOUND') return res.status(404).json({ message: 'User not found' });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});
