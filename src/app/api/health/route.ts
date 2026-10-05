import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/health: liveness + database connectivity, for uptime monitors and post-deploy checks. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("health check failed", e);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
