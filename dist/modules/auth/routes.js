"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const dto_1 = require("./dto");
const prisma_1 = require("../../lib/prisma");
const service_1 = require("./service");
const env_1 = require("../../config/env");
function extractPayload(reqBody, fallback = {}) {
    if (reqBody && typeof reqBody === 'object' && !Buffer.isBuffer(reqBody)) {
        return reqBody;
    }
    if (typeof reqBody === 'string') {
        const trimmed = reqBody.trim();
        if (trimmed) {
            try {
                return JSON.parse(trimmed);
            }
            catch (_error) {
                return fallback;
            }
        }
    }
    return fallback;
}
exports.authRouter = (0, express_1.Router)();
const parseRequestMeta = (req) => ({
    userAgent: req.get?.('user-agent') ?? undefined,
    ip: (typeof req.ip === 'string' ? req.ip : undefined) ?? req.socket?.remoteAddress ?? undefined
});
const LoginIdCheckDto = zod_1.z.object({
    loginId: zod_1.z.string().min(4).max(30)
});
exports.authRouter.post('/signup', async (req, res) => {
    try {
        const payload = extractPayload(req.body, req.query);
        const input = dto_1.SignUpDto.parse(req.body);
        const result = await (0, service_1.signUp)(input, parseRequestMeta(req));
        res.status(201).json(result);
    }
    catch (e) {
        if (e?.message === 'LOGIN_ID_TAKEN')
            return res.status(409).json({ message: 'Login ID already in use' });
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.authRouter.get('/check-id', async (req, res) => {
    try {
        const input = LoginIdCheckDto.parse({ loginId: req.query.loginId });
        const existing = await prisma_1.prisma.user.findUnique({ where: { loginId: input.loginId } });
        return res.json({ loginId: input.loginId, available: !existing });
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.authRouter.post('/login', async (req, res) => {
    try {
        const payload = extractPayload(req.body, req.query);
        const input = dto_1.LoginDto.parse(req.body);
        const result = await (0, service_1.login)(input, parseRequestMeta(req));
        res.json(result);
    }
    catch (e) {
        if (e?.message === 'INVALID_CREDENTIALS')
            return res.status(401).json({ message: 'Invalid ID or password' });
        if (e?.name === 'ZodError') {
            // Debug log to surface bad payloads from the client
            console.error('login validation failed', { issues: e.issues, body: req.body });
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        }
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.authRouter.post('/refresh', async (req, res) => {
    try {
        const input = dto_1.RefreshTokenDto.parse(req.body);
        const result = await (0, service_1.refreshTokens)(input, parseRequestMeta(req));
        res.json(result);
    }
    catch (e) {
        if (e?.message === 'INVALID_REFRESH' || e?.message === 'INVALID_TOKEN_TYPE') {
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.authRouter.post('/logout', async (req, res) => {
    try {
        const input = dto_1.RefreshTokenDto.parse(req.body);
        await (0, service_1.logout)(input);
        res.json({ success: true });
    }
    catch (e) {
        if (e?.message === 'INVALID_REFRESH' || e?.message === 'INVALID_TOKEN_TYPE') {
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.authRouter.get('/social/kakao/start', (req, res) => {
    if (!env_1.ENV.KAKAO_REST_API_KEY || !env_1.ENV.KAKAO_REDIRECT_URI) {
        return res.status(500).json({ message: 'Kakao OAuth not configured on server' });
    }
    const url = new URL('https://kauth.kakao.com/oauth/authorize');
    url.searchParams.set('client_id', env_1.ENV.KAKAO_REST_API_KEY);
    url.searchParams.set('redirect_uri', env_1.ENV.KAKAO_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (state)
        url.searchParams.set('state', state);
    res.redirect(url.toString());
});
exports.authRouter.get('/social/kakao/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!code)
        return res.status(400).json({ message: 'Missing authorization code' });
    try {
        const result = await (0, service_1.socialLogin)({ provider: 'kakao', code, redirectUri: env_1.ENV.KAKAO_REDIRECT_URI }, parseRequestMeta(req));
        if (result.status === 'needs_consent') {
            const target = env_1.ENV.SOCIAL_CONSENT_REDIRECT_URI || 'http://localhost:5173/social-consent';
            const url = new URL(target);
            url.searchParams.set('pendingToken', result.pendingToken);
            url.searchParams.set('provider', result.provider);
            if (result.profileName)
                url.searchParams.set('name', result.profileName);
            if (state)
                url.searchParams.set('redirect', state);
            return res.redirect(url.toString());
        }
        const successTarget = env_1.ENV.SOCIAL_LOGIN_SUCCESS_REDIRECT_URI || 'http://localhost:5173/home';
        const url = new URL(successTarget);
        if (state)
            url.searchParams.set('redirect', state);
        url.searchParams.set('provider', 'kakao');
        url.searchParams.set('accessToken', result.accessToken);
        if (result.refreshToken)
            url.searchParams.set('refreshToken', result.refreshToken);
        return res.redirect(url.toString());
    }
    catch (e) {
        if (['KAKAO_PROFILE_MISSING', 'KAKAO_TOKEN_EXCHANGE_FAILED'].includes(e?.message) ||
            ['KAKAO_ACCESS_TOKEN_REQUIRED'].includes(e?.message)) {
            return res.status(401).json({ message: 'Invalid or expired social token' });
        }
        if (e?.message === 'KAKAO_OAUTH_NOT_CONFIGURED') {
            return res.status(500).json({ message: 'Kakao OAuth not configured on server' });
        }
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
exports.authRouter.post('/social/login', async (req, res) => {
    try {
        const input = dto_1.SocialLoginDto.parse(req.body);
        const result = await (0, service_1.socialLogin)(input, parseRequestMeta(req));
        res.json(result);
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        if (['KAKAO_PROFILE_MISSING', 'GOOGLE_PROFILE_MISSING', 'GOOGLE_TOKEN_EXCHANGE_FAILED', 'KAKAO_TOKEN_EXCHANGE_FAILED'].includes(e?.message)) {
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
exports.authRouter.post('/social/consent', async (req, res) => {
    try {
        const input = dto_1.SocialConsentDto.parse(req.body);
        const session = await (0, service_1.completeSocialConsent)(input, parseRequestMeta(req));
        res.json(session);
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        if (['INVALID_TOKEN_TYPE', 'SOCIAL_CONSENT_REQUIRED'].includes(e?.message) || ['TokenExpiredError', 'JsonWebTokenError'].includes(e?.name)) {
            return res.status(401).json({ message: 'Invalid or expired pending token' });
        }
        if (e?.message === 'USER_NOT_FOUND')
            return res.status(404).json({ message: 'User not found' });
        console.error(e);
        res.status(500).json({ message: 'Internal error' });
    }
});
