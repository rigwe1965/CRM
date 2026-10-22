import { leadOptions, leadPost } from "@/lib/web-lead-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ tenant: string }> };

export async function OPTIONS(req: Request, ctx: Ctx) {
  return leadOptions(req, (await ctx.params).tenant);
}

/** POST /api/public/lead/:tenant { name, email?, phone?, message?, website }: one business's website contact form. See `leadPost`. Not wrapped in authed(). */
export async function POST(req: Request, ctx: Ctx) {
  return leadPost(req, (await ctx.params).tenant);
}
