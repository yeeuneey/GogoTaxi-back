"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialLogin = socialLogin;
exports.completeSocialConsent = completeSocialConsent;
exports.signUp = signUp;
exports.login = login;
exports.refreshTokens = refreshTokens;
exports.logout = logout;
exports.getProfile = getProfile;
exports.updateProfile = updateProfile;
exports.changePassword = changePassword;
const crypto_1 = require("crypto");
const axios_1 = __importDefault(require("axios"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma_1 = require("../../lib/prisma");
const jwt_1 = require("../../lib/jwt");
const env_1 = require("../../config/env");
const SALT_ROUNDS = env_1.ENV.BCRYPT_SALT_ROUNDS;
const SOCIAL_PENDING_ERROR = 'SOCIAL_CONSENT_REQUIRED';
function hashToken(token) {
    return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
}
function pickSafeUser(user) {
    return {
        id: user.id,
        loginId: user.loginId,
        name: user.name,
        email: user.email ?? null,
        phone: user.phone ?? null,
        gender: user.gender ?? null,
        birthDate: user.birthDate ?? null,
        createdAt: user.createdAt
    };
}
async function createSession(user, meta) {
    const access = (0, jwt_1.issueAccessToken)({ sub: user.id, loginId: user.loginId });
    const refresh = (0, jwt_1.issueRefreshToken)({ sub: user.id, loginId: user.loginId });
    const tokenHash = hashToken(refresh.token);
    await prisma_1.prisma.refreshToken.create({
        data: {
            userId: user.id,
            tokenHash,
            expiresAt: refresh.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
            userAgent: meta.userAgent,
            ip: meta.ip
        }
    });
    return {
        user: pickSafeUser(user),
        accessToken: access.token,
        refreshToken: refresh.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshTokenExpiresAt: refresh.expiresAt
    };
}
const socialUserSelect = {
    id: true,
    loginId: true,
    email: true,
    name: true,
    phone: true,
    gender: true,
    birthDate: true,
    createdAt: true,
    termsConsent: true,
    smsConsent: true
};
async function generateLoginId(base) {
    const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
    let candidate = sanitized;
    let counter = 1;
    // Keep length under 30 chars per existing validation
    while (await prisma_1.prisma.user.findUnique({ where: { loginId: candidate } })) {
        const suffix = `_${counter++}`;
        candidate = `${sanitized}${suffix}`.slice(0, 30);
    }
    return candidate;
}
async function findExistingSocialAccount(provider, providerUserId) {
    return prisma_1.prisma.socialAccount.findUnique({
        where: { provider_providerUserId: { provider, providerUserId } },
        include: { user: { select: socialUserSelect } }
    });
}
async function persistSocialAccount(params) {
    await prisma_1.prisma.socialAccount.upsert({
        where: { provider_providerUserId: { provider: params.provider, providerUserId: params.providerUserId } },
        update: {
            userId: params.userId,
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            profile: params.profile
        },
        create: {
            userId: params.userId,
            provider: params.provider,
            providerUserId: params.providerUserId,
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            profile: params.profile
        }
    });
}
async function resolveEmail(email) {
    if (!email)
        return null;
    const existing = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (existing)
        return null;
    return email;
}
async function ensureSocialUser(params) {
    const existing = await findExistingSocialAccount(params.provider, params.profile.id);
    if (existing?.user) {
        await persistSocialAccount({
            userId: existing.user.id,
            provider: params.provider,
            providerUserId: params.profile.id,
            accessToken: params.tokens.accessToken,
            refreshToken: params.tokens.refreshToken,
            profile: params.rawProfile ?? params.profile
        });
        return { user: existing.user, newlyCreated: false };
    }
    const loginId = await generateLoginId(`${params.provider}_${params.profile.id}`);
    const email = await resolveEmail(params.profile.email);
    const user = await prisma_1.prisma.user.create({
        data: {
            loginId,
            name: params.profile.name ?? null,
            email,
            termsConsent: false,
            smsConsent: false,
            passwordHash: null
        },
        select: socialUserSelect
    });
    await persistSocialAccount({
        userId: user.id,
        provider: params.provider,
        providerUserId: params.profile.id,
        accessToken: params.tokens.accessToken,
        refreshToken: params.tokens.refreshToken,
        profile: params.rawProfile ?? params.profile
    });
    return { user, newlyCreated: true };
}
async function fetchKakaoProfile(accessToken) {
    const { data } = await axios_1.default.get('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const id = data?.id ? String(data.id) : '';
    if (!id)
        throw new Error('KAKAO_PROFILE_MISSING');
    const name = data?.kakao_account?.profile?.nickname ??
        data?.properties?.nickname ??
        data?.kakao_account?.profile_nickname ??
        undefined;
    const email = data?.kakao_account?.email ?? undefined;
    const profile = { id, name, email };
    return { profile, raw: data };
}
async function fetchGoogleProfileFromAccessToken(accessToken) {
    const { data } = await axios_1.default.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const id = data?.sub ? String(data.sub) : '';
    if (!id)
        throw new Error('GOOGLE_PROFILE_MISSING');
    const name = data?.name ?? data?.given_name ?? undefined;
    const email = data?.email ?? undefined;
    const profile = { id, name, email };
    return { profile, raw: data, accessToken };
}
async function exchangeGoogleCodeForTokens(code, redirectUri) {
    if (!env_1.ENV.GOOGLE_CLIENT_ID || !env_1.ENV.GOOGLE_CLIENT_SECRET) {
        throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');
    }
    const params = new URLSearchParams({
        code,
        client_id: env_1.ENV.GOOGLE_CLIENT_ID,
        client_secret: env_1.ENV.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri || 'postmessage',
        grant_type: 'authorization_code'
    });
    const { data } = await axios_1.default.post('https://oauth2.googleapis.com/token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!data?.access_token)
        throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
async function resolveProviderProfile(input) {
    if (input.provider === 'kakao') {
        if (!input.accessToken)
            throw new Error('KAKAO_ACCESS_TOKEN_REQUIRED');
        const { profile, raw } = await fetchKakaoProfile(input.accessToken);
        return {
            provider: input.provider,
            profile,
            tokens: { accessToken: input.accessToken },
            rawProfile: raw
        };
    }
    if (input.provider === 'google') {
        if (input.accessToken) {
            const { profile, raw, accessToken } = await fetchGoogleProfileFromAccessToken(input.accessToken);
            return {
                provider: input.provider,
                profile,
                tokens: { accessToken },
                rawProfile: raw
            };
        }
        if (input.code) {
            const tokens = await exchangeGoogleCodeForTokens(input.code, input.redirectUri);
            const { profile, raw } = await fetchGoogleProfileFromAccessToken(tokens.accessToken);
            return {
                provider: input.provider,
                profile,
                tokens,
                rawProfile: raw
            };
        }
        throw new Error('GOOGLE_TOKEN_REQUIRED');
    }
    throw new Error('UNSUPPORTED_PROVIDER');
}
async function socialLogin(input, meta) {
    const resolved = await resolveProviderProfile(input);
    const { user } = await ensureSocialUser(resolved);
    if (!user.termsConsent) {
        const pending = (0, jwt_1.issueSocialPendingToken)({ sub: user.id, loginId: user.loginId, provider: resolved.provider });
        return {
            status: 'needs_consent',
            provider: resolved.provider,
            pendingToken: pending.token,
            profileName: user.name ?? undefined
        };
    }
    const sessionUser = await prisma_1.prisma.user.findUnique({ where: { id: user.id }, select: socialUserSelect });
    if (!sessionUser)
        throw new Error('USER_NOT_FOUND');
    const session = await createSession(sessionUser, meta);
    return { status: 'ok', ...session };
}
async function completeSocialConsent(input, meta) {
    if (!input.termsConsent)
        throw new Error(SOCIAL_PENDING_ERROR);
    const payload = (0, jwt_1.verifySocialPendingToken)(input.pendingToken);
    const user = await prisma_1.prisma.user.update({
        where: { id: payload.sub },
        data: {
            termsConsent: true,
            smsConsent: input.smsConsent ?? false,
            name: input.name ?? undefined,
            gender: input.gender ?? undefined
        },
        select: socialUserSelect
    });
    const session = await createSession(user, meta);
    return session;
}
async function signUp(input, meta) {
    const exists = await prisma_1.prisma.user.findUnique({ where: { loginId: input.loginId } });
    if (exists) {
        throw new Error('LOGIN_ID_TAKEN');
    }
    const passwordHash = await bcrypt_1.default.hash(input.password, SALT_ROUNDS);
    const user = await prisma_1.prisma.user.create({
        data: {
            passwordHash,
            loginId: input.loginId,
            name: input.name,
            gender: input.gender,
            phone: input.phone,
            birthDate: input.birthDate,
            smsConsent: input.smsConsent,
            termsConsent: input.termsConsent
        },
        select: {
            id: true,
            loginId: true,
            email: true,
            name: true,
            phone: true,
            gender: true,
            birthDate: true,
            createdAt: true
        }
    });
    return createSession(user, meta);
}
async function login(input, meta) {
    const user = await prisma_1.prisma.user.findUnique({ where: { loginId: input.loginId } });
    if (!user || !user.passwordHash)
        throw new Error('INVALID_CREDENTIALS');
    const ok = await bcrypt_1.default.compare(input.password, user.passwordHash);
    if (!ok)
        throw new Error('INVALID_CREDENTIALS');
    const safeUser = pickSafeUser(user);
    return createSession(safeUser, meta);
}
async function refreshTokens(input, meta) {
    const payload = (0, jwt_1.verifyRefreshJwt)(input.refreshToken);
    const tokenHash = hashToken(input.refreshToken);
    const existing = await prisma_1.prisma.refreshToken.findFirst({
        where: {
            userId: payload.sub,
            tokenHash,
            revokedAt: null,
            expiresAt: { gt: new Date() }
        }
    });
    if (!existing)
        throw new Error('INVALID_REFRESH');
    await prisma_1.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' }
    });
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, loginId: true, email: true, name: true, phone: true, gender: true, birthDate: true, createdAt: true }
    });
    if (!user)
        throw new Error('USER_NOT_FOUND');
    return createSession(user, meta);
}
async function logout(input) {
    const payload = (0, jwt_1.verifyRefreshJwt)(input.refreshToken);
    const tokenHash = hashToken(input.refreshToken);
    const existing = await prisma_1.prisma.refreshToken.findFirst({
        where: {
            userId: payload.sub,
            tokenHash,
            revokedAt: null
        }
    });
    if (!existing)
        throw new Error('INVALID_REFRESH');
    await prisma_1.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' }
    });
}
async function getProfile(userId) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            loginId: true,
            name: true,
            email: true,
            phone: true,
            gender: true,
            birthDate: true,
            createdAt: true,
            smsConsent: true,
            termsConsent: true
        }
    });
    if (!user)
        throw new Error('USER_NOT_FOUND');
    return user;
}
async function updateProfile(userId, input) {
    const data = {};
    if (input.name !== undefined)
        data.name = input.name;
    if (input.phone !== undefined)
        data.phone = input.phone;
    if (input.gender !== undefined)
        data.gender = input.gender;
    if (input.birthDate !== undefined)
        data.birthDate = input.birthDate;
    const user = await prisma_1.prisma.user.update({
        where: { id: userId },
        data,
        select: {
            id: true,
            loginId: true,
            name: true,
            email: true,
            phone: true,
            gender: true,
            birthDate: true,
            smsConsent: true,
            termsConsent: true,
            createdAt: true
        }
    });
    return user;
}
async function changePassword(userId, input) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, passwordHash: true }
    });
    if (!user || !user.passwordHash)
        throw new Error('PASSWORD_NOT_SET');
    const ok = await bcrypt_1.default.compare(input.currentPassword, user.passwordHash);
    if (!ok)
        throw new Error('INVALID_CURRENT_PASSWORD');
    const nextHash = await bcrypt_1.default.hash(input.newPassword, SALT_ROUNDS);
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: nextHash }
    });
}
