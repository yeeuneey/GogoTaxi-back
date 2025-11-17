import 'dotenv/config';

export const ENV = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: process.env.DATABASE_URL ?? ''
};

if (!ENV.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL is empty. Set it in .env');
}