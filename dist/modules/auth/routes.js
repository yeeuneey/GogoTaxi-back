"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const dto_1 = require("./dto");
const service_1 = require("./service");
exports.authRouter = (0, express_1.Router)();
const parseRequestMeta = (req) => ({
    userAgent: req.get?.('user-agent') ?? undefined,
    ip: (typeof req.ip === 'string' ? req.ip : undefined) ?? req.socket?.remoteAddress ?? undefined
});
exports.authRouter.post('/signup', async (req, res) => {
    try {
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
exports.authRouter.post('/login', async (req, res) => {
    try {
        const input = dto_1.LoginDto.parse(req.body);
        const result = await (0, service_1.login)(input, parseRequestMeta(req));
        res.json(result);
    }
    catch (e) {
        if (e?.message === 'INVALID_CREDENTIALS')
            return res.status(401).json({ message: 'Invalid ID or password' });
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
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
exports.authRouter.post('/social/login', async (req, res) => {
    try {
        const input = dto_1.SocialLoginDto.parse(req.body);
        const result = await (0, service_1.socialLogin)(input, parseRequestMeta(req));
        res.json(result);
    }
    catch (e) {
        if (e?.name === 'ZodError')
            return res.status(400).json({ message: 'Validation failed', issues: e.issues });
        if (['KAKAO_PROFILE_MISSING', 'GOOGLE_PROFILE_MISSING', 'GOOGLE_TOKEN_EXCHANGE_FAILED'].includes(e?.message)) {
            return res.status(401).json({ message: 'Invalid or expired social token' });
        }
        if (['KAKAO_ACCESS_TOKEN_REQUIRED', 'GOOGLE_TOKEN_REQUIRED'].includes(e?.message)) {
            return res.status(400).json({ message: 'Missing social login token' });
        }
        if (e?.message === 'GOOGLE_OAUTH_NOT_CONFIGURED') {
            return res.status(500).json({ message: 'Google OAuth not configured on server' });
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
