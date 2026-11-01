import { appUrl } from "@/lib/mail";
import { securityTxt } from "@/lib/support";

export const dynamic = "force-dynamic";

/** GET /.well-known/security.txt: public, so that anyone who finds a vulnerability knows who to tell. 404 until SECURITY_EMAIL or SUPPORT_EMAIL is set. */
export function GET() {
  const body = securityTxt(appUrl());
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
