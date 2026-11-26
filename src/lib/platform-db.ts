import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@/lib/prisma-client";

/**
 * The client for work that belongs to no single business: signing in (the business is learned from the user),
 * password reset and invite tokens, the daily jobs that loop over businesses, and the Stripe webhook before it
 * knows whose payment link it holds. It connects as PLATFORM_DATABASE_URL, a role that is not held back by
 * row-level security, so it can read across businesses: keep its use short and listed in
 * tests/tenant-scoping.test.ts. Without PLATFORM_DATABASE_URL it falls back to DATABASE_URL, which is fine for
 * local development (see TECHNICIAN.md).
 */
const globalForPrisma = globalThis as unknown as { platformPrisma?: PrismaClient };

export const platformDb =
  globalForPrisma.platformPrisma ??
  createPrismaClient({ url: process.env.PLATFORM_DATABASE_URL || undefined });

if (process.env.NODE_ENV !== "production") globalForPrisma.platformPrisma = platformDb;
