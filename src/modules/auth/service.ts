import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcrypt';
import { SignUpDto, LoginDto, RefreshTokenDto, UpdateProfileDto, ChangePasswordDto } from './dto';
import { issueAccessToken, issueRefreshToken, verifyRefreshJwt } from '../../lib/jwt';
import { ENV } from '../../config/env';

const SALT_ROUNDS = ENV.BCRYPT_SALT_ROUNDS;

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

export async function signUp(input: SignUpDto, meta: RequestMeta) {
  const exists = await prisma.user.findUnique({ where: { loginId: input.loginId } });
  if (exists) {
    throw new Error('LOGIN_ID_TAKEN');
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
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
}
