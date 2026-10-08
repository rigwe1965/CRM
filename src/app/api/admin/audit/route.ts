import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { readQuery } from "@/lib/api";
import { authed } from "@/lib/route";

export const dynamic = "force-dynamic";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});

/** GET /api/admin/audit: newest first. `q` matches the action, actor email, summary or record id. */
export const GET = authed(async ({ req }) => {
  const { page, pageSize, q } = readQuery(req, query);
  const where = q
    ? {
        OR: [
          { action: { contains: q, mode: "insensitive" as const } },
          { actorEmail: { contains: q, mode: "insensitive" as const } },
          { summary: { contains: q, mode: "insensitive" as const } },
          { entityId: q },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return NextResponse.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
}, "ADMIN");
