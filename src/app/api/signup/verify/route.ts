import { NextResponse } from "next/server";
import { apiError, parseBody } from "@/lib/api";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { signupEnabled, verifySignup } from "@/lib/signup";
import { verifySignupSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** POST /api/signup/verify { token }: confirms the emailed link; the business becomes active and its admin can sign in. */
export async function POST(req: Request) {
  if (!signupEnabled()) return apiError("Not found", 404);
  const limit = await rateLimit(`signup-verify:${clientIp(req.headers)}`, LIMITS.passwordReset);
  if (!limit.allowed) return apiError(`Too many attempts. Try again in ${limit.retryAfter}s.`, 429);
  const body = await parseBody(req, verifySignupSchema);
  if ("response" in body) return body.response;
  if (!(await verifySignup(body.data.token))) return apiError("This confirmation link is invalid or has expired.", 400);
  return NextResponse.json({ ok: true });
}
