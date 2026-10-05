import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi";

// Public: describes the API, exposes no data.
export function GET() {
  return NextResponse.json(buildOpenApiDocument());
}
