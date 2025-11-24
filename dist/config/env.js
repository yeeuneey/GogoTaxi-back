"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV = void 0;
require("dotenv/config");
exports.ENV = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? 8080),
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET ?? 'dev',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',
    JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN ?? '15m',
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? '14d',
    BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
    KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY ?? '',
    KAKAO_ADMIN_KEY: process.env.KAKAO_ADMIN_KEY ?? '',
    KAKAO_JS_KEY: process.env.KAKAO_JS_KEY ?? '',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? ''
};
if (!exports.ENV.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL is empty. Set it in .env');
}
