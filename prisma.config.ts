import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

dotenv.config({ path: "prisma/.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
