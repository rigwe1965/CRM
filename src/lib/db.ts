import { createPrismaClient } from "@/lib/prisma-client";
import { createTenantDb } from "@/lib/tenant-db";

/**
 * The application's database client. Every query runs as the business set by `withTenant` (`authed()` does it
 * for API routes), and Postgres row-level security refuses the rows of any other business. Work that belongs to
 * no single business uses `platformDb` instead.
 */
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createTenantDb> };

export const db =
  globalForPrisma.prisma ??
  createTenantDb(createPrismaClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
