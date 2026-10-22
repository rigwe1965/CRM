import { DEFAULT_TENANT_ID } from "@/lib/tenant";
import { leadOptions, leadPost } from "@/lib/web-lead-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The original address, kept for the first business so its website needs no change. Every other business uses
// /api/public/lead/<business>.

export const OPTIONS = (req: Request) => leadOptions(req, DEFAULT_TENANT_ID);

/** POST /api/public/lead { name, email?, phone?, message?, website }: the website contact form. See `leadPost`. Not wrapped in authed(). */
export const POST = (req: Request) => leadPost(req, DEFAULT_TENANT_ID);
