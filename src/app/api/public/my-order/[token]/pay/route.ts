import { NextResponse } from "next/server";
import { appUrl } from "@/lib/mail";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { resolveOrderLink } from "@/lib/order-links";
import { customerPayUrl } from "@/lib/customer-order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/public/my-order/:token/pay: the Pay now button on a customer's order page. Sends the customer on to
 * Stripe for the amount due, or back to the page with a notice when online payment is not possible. Not wrapped in
 * authed(): the private link is the credential. Every link that does not work gets the same plain 404.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limit = await rateLimit(`customer-pay:${clientIp(req.headers)}`, LIMITS.customerPay);
  if (!limit.allowed) return new NextResponse("Too many requests. Please try again in a few minutes.", { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const link = await resolveOrderLink(token);
  if (!link) return new NextResponse("Not found", { status: 404 });

  const url = await customerPayUrl(link);
  // 303 turns the form POST into a GET at the destination. The address comes from the configured site, never the request.
  return NextResponse.redirect(url ?? `${appUrl()}/my-order/${token}?pay=unavailable`, 303);
}
