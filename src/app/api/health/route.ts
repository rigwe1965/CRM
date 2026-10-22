import { NextResponse } from "next/server";
import { platformDb } from "@/lib/platform-db";

export const dynamic = "force-dynamic";

/** GET /api/health: liveness + database connectivity, for uptime monitors and post-deploy checks. */
export async function GET() {
  try {
    await platformDb.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("health check failed", e);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
