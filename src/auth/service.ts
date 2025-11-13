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
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      nickname: input.nickname
    },
    select: { id: true, email: true, nickname: true, createdAt: true }
  });
  const token = signJwt({ sub: user.id, email: user.email });
  return { user, token };
}

export async function login(input: LoginDto) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new Error('INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(input.password, (user as any).passwordHash);
  if (!ok) throw new Error('INVALID_CREDENTIALS');

  const safeUser = { id: user.id, email: user.email, nickname: user.nickname, createdAt: user.createdAt };
  const token = signJwt({ sub: user.id, email: user.email });
  return { user: safeUser, token };
}