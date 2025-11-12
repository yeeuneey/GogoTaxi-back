import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma.js';
import { signJwt } from '../../lib/jwt.js';
import type { SignUpInput, LoginInput } from './dto.js';

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);

export async function signUp(input: SignUpInput) {
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) {
    throw new Error('EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name
    },
    select: { id: true, email: true, name: true, createdAt: true }
  });
  const token = signJwt({ sub: user.id, email: user.email });
  return { user, token };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new Error('INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new Error('INVALID_CREDENTIALS');

  const safeUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  };
  const token = signJwt({ sub: user.id, email: user.email });
  return { user: safeUser, token };
}
