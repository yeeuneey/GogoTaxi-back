/*
  Warnings:

  - You are about to drop the column `nickname` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[login_id]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `login_id` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

-- Ensure login_id column exists, otherwise add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'User'
      AND column_name = 'login_id'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "login_id" TEXT NOT NULL;
  END IF;
END
$$;

ALTER TABLE "User"
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "name" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "SocialAccount" (
    "id" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "profile" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SocialAccount_user_id_idx" ON "SocialAccount"("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_provider_provider_user_id_key" ON "SocialAccount"("provider", "provider_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_token_hash_key" ON "RefreshToken"("token_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "User_login_id_key" ON "User"("login_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SocialAccount_user_id_fkey'
  ) THEN
    ALTER TABLE "SocialAccount"
    ADD CONSTRAINT "SocialAccount_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RefreshToken_user_id_fkey'
  ) THEN
    ALTER TABLE "RefreshToken"
    ADD CONSTRAINT "RefreshToken_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
