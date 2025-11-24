<<<<<<< HEAD
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcrypt';
import { SignUpDto, LoginDto } from './dto';
import { signJwt } from '../../lib/jwt';

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);

export async function signUp(input: SignUpDto) {
  // 이메일 중복 체크
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) {
    throw new Error('EMAIL_TAKEN');
=======
import { createHash } from 'crypto';
import axios from 'axios';
import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma';
import {
  SignUpDto,
  LoginDto,
  RefreshTokenDto,
  UpdateProfileDto,
  ChangePasswordDto,
  SocialLoginDto,
  SocialConsentDto
} from './dto';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshJwt,
  issueSocialPendingToken,
  verifySocialPendingToken
} from '../../lib/jwt';
import { ENV } from '../../config/env';

const SALT_ROUNDS = ENV.BCRYPT_SALT_ROUNDS;
const SOCIAL_PENDING_ERROR = 'SOCIAL_CONSENT_REQUIRED';

type SocialProvider = 'kakao' | 'google';
type SocialProfile = { id: string; name?: string | null; email?: string | null };

type RequestMeta = {
  userAgent?: string;
  ip?: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function pickSafeUser(user: any) {
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

async function createSession(
  user: {
    id: string;
    loginId: string;
    email: string | null;
    name: string | null;
    phone?: string | null;
    gender?: string | null;
    birthDate?: Date | null;
    createdAt: Date;
  },
  meta: RequestMeta
) {
  const access = issueAccessToken({ sub: user.id, loginId: user.loginId });
  const refresh = issueRefreshToken({ sub: user.id, loginId: user.loginId });
  const tokenHash = hashToken(refresh.token);

  await prisma.refreshToken.create({
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

async function generateLoginId(base: string) {
  const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
  let candidate = sanitized;
  let counter = 1;

  // Keep length under 30 chars per existing validation
  while (await prisma.user.findUnique({ where: { loginId: candidate } })) {
    const suffix = `_${counter++}`;
    candidate = `${sanitized}${suffix}`.slice(0, 30);
  }
  return candidate;
}

async function findExistingSocialAccount(provider: SocialProvider, providerUserId: string) {
  return prisma.socialAccount.findUnique({
    where: { provider_providerUserId: { provider, providerUserId } },
    include: { user: { select: socialUserSelect } }
  });
}

async function persistSocialAccount(params: {
  userId: string;
  provider: SocialProvider;
  providerUserId: string;
  accessToken?: string;
  refreshToken?: string;
  profile?: any;
}) {
  await prisma.socialAccount.upsert({
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

async function resolveEmail(email?: string | null) {
  if (!email) return null;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return null;
  return email;
}

async function ensureSocialUser(params: {
  provider: SocialProvider;
  profile: SocialProfile;
  tokens: { accessToken?: string; refreshToken?: string };
  rawProfile?: any;
}) {
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

  const user = await prisma.user.create({
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

async function fetchKakaoProfile(accessToken: string) {
  const { data } = await axios.get('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const id = data?.id ? String(data.id) : '';
  if (!id) throw new Error('KAKAO_PROFILE_MISSING');

  // Keep consent minimal: rely only on Kakao user id.
  const profile: SocialProfile = { id };
  return { profile, raw: data };
}

async function exchangeKakaoCodeForAccessToken(code: string, redirectUri?: string) {
  if (!ENV.KAKAO_REST_API_KEY || !ENV.KAKAO_REDIRECT_URI) {
    throw new Error('KAKAO_OAUTH_NOT_CONFIGURED');
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: ENV.KAKAO_REST_API_KEY,
    redirect_uri: redirectUri || ENV.KAKAO_REDIRECT_URI,
    code
  });
  if (ENV.KAKAO_CLIENT_SECRET) {
    params.append('client_secret', ENV.KAKAO_CLIENT_SECRET);
  }

  const { data } = await axios.post('https://kauth.kakao.com/oauth/token', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (!data?.access_token) throw new Error('KAKAO_TOKEN_EXCHANGE_FAILED');
  return { accessToken: data.access_token as string, refreshToken: data.refresh_token as string | undefined };
}

async function fetchGoogleProfileFromAccessToken(accessToken: string) {
  const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const id = data?.sub ? String(data.sub) : '';
  if (!id) throw new Error('GOOGLE_PROFILE_MISSING');
  const name = data?.name ?? data?.given_name ?? undefined;
  const email = data?.email ?? undefined;
  const profile: SocialProfile = { id, name, email };
  return { profile, raw: data, accessToken };
}

async function exchangeGoogleCodeForTokens(code: string, redirectUri?: string) {
  if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');
  }
  const params = new URLSearchParams({
    code,
    client_id: ENV.GOOGLE_CLIENT_ID,
    client_secret: ENV.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri || 'postmessage',
    grant_type: 'authorization_code'
  });

  const { data } = await axios.post('https://oauth2.googleapis.com/token', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!data?.access_token) throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
  return { accessToken: data.access_token as string, refreshToken: data.refresh_token as string | undefined };
}

async function resolveProviderProfile(input: SocialLoginDto) {
  if (input.provider === 'kakao') {
    if (!input.accessToken && !input.code) throw new Error('KAKAO_ACCESS_TOKEN_REQUIRED');

    const tokens = input.accessToken
      ? { accessToken: input.accessToken }
      : await exchangeKakaoCodeForAccessToken(input.code || '', input.redirectUri);

    if (!tokens.accessToken) throw new Error('KAKAO_ACCESS_TOKEN_REQUIRED');
    const { profile, raw } = await fetchKakaoProfile(tokens.accessToken);
    return {
      provider: input.provider as SocialProvider,
      profile,
      tokens,
      rawProfile: raw
    };
  }

  if (input.provider === 'google') {
    if (input.accessToken) {
      const { profile, raw, accessToken } = await fetchGoogleProfileFromAccessToken(input.accessToken);
      return {
        provider: input.provider as SocialProvider,
        profile,
        tokens: { accessToken },
        rawProfile: raw
      };
    }
    if (input.code) {
      const tokens = await exchangeGoogleCodeForTokens(input.code, input.redirectUri);
      const { profile, raw } = await fetchGoogleProfileFromAccessToken(tokens.accessToken);
      return {
        provider: input.provider as SocialProvider,
        profile,
        tokens,
        rawProfile: raw
      };
    }
    throw new Error('GOOGLE_TOKEN_REQUIRED');
  }

  throw new Error('UNSUPPORTED_PROVIDER');
}

export async function socialLogin(input: SocialLoginDto, meta: RequestMeta) {
  const resolved = await resolveProviderProfile(input);
  const { user } = await ensureSocialUser(resolved);

  if (!user.termsConsent) {
    const pending = issueSocialPendingToken({ sub: user.id, loginId: user.loginId, provider: resolved.provider });
    return {
      status: 'needs_consent' as const,
      provider: resolved.provider,
      pendingToken: pending.token,
      profileName: user.name ?? undefined
    };
  }

  const sessionUser = await prisma.user.findUnique({ where: { id: user.id }, select: socialUserSelect });
  if (!sessionUser) throw new Error('USER_NOT_FOUND');
  const session = await createSession(sessionUser, meta);
  return { status: 'ok' as const, ...session };
}

export async function completeSocialConsent(input: SocialConsentDto, meta: RequestMeta) {
  if (!input.termsConsent) throw new Error(SOCIAL_PENDING_ERROR);

  const payload = verifySocialPendingToken(input.pendingToken);
  const user = await prisma.user.update({
    where: { id: payload.sub },
    data: {
      termsConsent: true,
      smsConsent: input.smsConsent ?? false,
      name: input.name ?? undefined,
      gender: input.gender ?? undefined,
      phone: input.phone ?? undefined,
      birthDate: input.birthDate ?? undefined
    },
    select: socialUserSelect
  });

  const session = await createSession(user, meta);
  return session;
}

export async function signUp(input: SignUpDto, meta: RequestMeta) {
  const exists = await prisma.user.findUnique({ where: { loginId: input.loginId } });
  if (exists) {
    throw new Error('LOGIN_ID_TAKEN');
>>>>>>> upstream/main
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
<<<<<<< HEAD
      email: input.email,
      name: input.nickname || input.email,
      passwordHash,
      nickname: input.nickname
    },
    select: { id: true, email: true, nickname: true, createdAt: true }
  });
  const token = signJwt({ sub: user.id, email: user.email! });
  return { user, token };
}

export async function login(input: LoginDto) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new Error('INVALID_CREDENTIALS');
  if (!user.passwordHash) throw new Error('INVALID_CREDENTIALS');

  if (!user.passwordHash) throw new Error('INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new Error('INVALID_CREDENTIALS');

  const safeUser = { id: user.id, email: user.email, nickname: user.nickname, createdAt: user.createdAt };
  if (!safeUser.email) throw new Error('INVALID_CREDENTIALS');
  const token = signJwt({ sub: user.id, email: safeUser.email });
  return { user: safeUser, token };
=======
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

export async function login(input: LoginDto, meta: RequestMeta) {
  const user = await prisma.user.findUnique({ where: { loginId: input.loginId } });
  if (!user || !(user as any).passwordHash) throw new Error('INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(input.password, (user as any).passwordHash);
  if (!ok) throw new Error('INVALID_CREDENTIALS');

  const safeUser = pickSafeUser(user);
  return createSession(safeUser as any, meta);
}

export async function refreshTokens(input: RefreshTokenDto, meta: RequestMeta) {
  const payload = verifyRefreshJwt(input.refreshToken);
  const tokenHash = hashToken(input.refreshToken);

  const existing = await prisma.refreshToken.findFirst({
    where: {
      userId: payload.sub,
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    }
  });
  if (!existing) throw new Error('INVALID_REFRESH');

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), revokedReason: 'ROTATED' }
  });

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, loginId: true, email: true, name: true, phone: true, gender: true, birthDate: true, createdAt: true }
  });
  if (!user) throw new Error('USER_NOT_FOUND');

  return createSession(user, meta);
}

export async function logout(input: RefreshTokenDto) {
  const payload = verifyRefreshJwt(input.refreshToken);
  const tokenHash = hashToken(input.refreshToken);

  const existing = await prisma.refreshToken.findFirst({
    where: {
      userId: payload.sub,
      tokenHash,
      revokedAt: null
    }
  });
  if (!existing) throw new Error('INVALID_REFRESH');

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), revokedReason: 'LOGOUT' }
  });
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
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
  if (!user) throw new Error('USER_NOT_FOUND');
  return user;
}

export async function updateProfile(userId: string, input: UpdateProfileDto) {
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.birthDate !== undefined) data.birthDate = input.birthDate;

  const user = await prisma.user.update({
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

export async function changePassword(userId: string, input: ChangePasswordDto) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true }
  });
  if (!user || !user.passwordHash) throw new Error('PASSWORD_NOT_SET');

  const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!ok) throw new Error('INVALID_CURRENT_PASSWORD');

  const nextHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: nextHash }
  });
>>>>>>> upstream/main
}
