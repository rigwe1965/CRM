import { NextResponse } from "next/server";
import { authed } from "@/lib/route";
import { buildOpenApiDocument } from "@/lib/openapi";

// Describes the API and exposes no data, but it maps every endpoint, so it needs a signed-in session.
export const GET = authed(async () => NextResponse.json(buildOpenApiDocument()));
