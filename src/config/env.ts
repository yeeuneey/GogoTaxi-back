import dotenv from "dotenv";

dotenv.config();

const normalizeCorsOrigin = (
  value?: string
): string | string[] | boolean => {
  if (!value || value === "*") return "*";
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : true;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  CORS_ORIGIN: normalizeCorsOrigin(process.env.CORS_ORIGIN),
};

