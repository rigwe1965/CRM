import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 reads the connection for the CLI (migrate, db push, studio) from here, not from schema.prisma.
 * Migrations need a direct (non-pooled) connection: DIRECT_URL when set (Neon's unpooled URL on Vercel), else DATABASE_URL.
 * The app itself connects through a driver adapter (src/lib/prisma-client.ts), not through this file.
 * `generate` does not connect, so the fallback to "" keeps `prisma generate` (postinstall, build machines) working.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "" },
});
