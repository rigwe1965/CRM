import { NextResponse, after } from "next/server";
import { apiError, parseBody } from "@/lib/api";
import { captchaConfigured, verifyCaptcha } from "@/lib/captcha";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { createSignup, signupEnabled } from "@/lib/signup";
import { signupSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/signup { businessName, name, email, password }: a new business signs itself up. Public on purpose, so it is
 * off unless SIGNUP_ENABLED=1, rate limited per address, per email and overall, and answers the same whether or not the
 * email already has an account (the work runs after the response). The business stays PENDING until the emailed link is used.
 */
export async function POST(req: Request) {
  if (!signupEnabled()) return apiError("Not found", 404);
  const body = await parseBody(req, signupSchema);
  if ("response" in body) return body.response;
  const { captchaToken, ...input } = body.data;

  const limits = await Promise.all([rateLimit(`signup:${clientIp(req.headers)}`, LIMITS.signup), rateLimit(`signup-email:${input.email}`, LIMITS.signupEmail), rateLimit("signup:all", LIMITS.signupAll)]);
  const blocked = limits.find((l) => !l.allowed);
  if (blocked) return apiError(`Too many sign-up attempts. Try again in ${blocked.retryAfter}s.`, 429);

  // After the cheap limits, before any work: a bot that can't pass the CAPTCHA costs us nothing.
  if (captchaConfigured() && !(await verifyCaptcha(captchaToken, clientIp(req.headers)))) {
    return apiError("Please complete the check that you are not a robot, then try again.", 400, undefined, "CAPTCHA_FAILED");
  }

  let devLink: string | undefined;
  if (process.env.NODE_ENV !== "production") {
    // With no email provider the link has to come back in the response; run inline so it can.
    devLink = (await createSignup(input).catch((e) => (console.error("signup failed", e), undefined)))?.devLink;
  } else {
    after(async () => {
      try {
        await createSignup(input);
      } catch (e) {
        console.error("signup failed", e instanceof Error ? e.message : e);
      }
    });
  }
  return NextResponse.json({ ok: true, ...(devLink && { devLink }) });
}
