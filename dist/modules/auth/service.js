"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signUp = signUp;
exports.login = login;
const prisma_1 = require("../../lib/prisma");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../../lib/jwt");
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);
async function signUp(input) {
    // 이메일 중복 체크
    const exists = await prisma_1.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) {
        throw new Error('EMAIL_TAKEN');
    }
    const passwordHash = await bcrypt_1.default.hash(input.password, SALT_ROUNDS);
    const user = await prisma_1.prisma.user.create({
        data: {
            email: input.email,
            name: input.nickname || input.email,
            passwordHash,
            nickname: input.nickname
        },
        select: { id: true, email: true, nickname: true, createdAt: true }
    });
    const token = (0, jwt_1.signJwt)({ sub: user.id, email: user.email });
    return { user, token };
}
async function login(input) {
    const user = await prisma_1.prisma.user.findUnique({ where: { email: input.email } });
    if (!user)
        throw new Error('INVALID_CREDENTIALS');
    if (!user.passwordHash)
        throw new Error('INVALID_CREDENTIALS');
    if (!user.passwordHash)
        throw new Error('INVALID_CREDENTIALS');
    const ok = await bcrypt_1.default.compare(input.password, user.passwordHash);
    if (!ok)
        throw new Error('INVALID_CREDENTIALS');
    const safeUser = { id: user.id, email: user.email, nickname: user.nickname, createdAt: user.createdAt };
    if (!safeUser.email)
        throw new Error('INVALID_CREDENTIALS');
    const token = (0, jwt_1.signJwt)({ sub: user.id, email: safeUser.email });
    return { user: safeUser, token };
}
