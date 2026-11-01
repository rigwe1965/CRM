import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { dismissOnboarding, onboardingView } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

/** GET /api/onboarding (admins): the first-run checklist, with each step's state worked out from the business's own data. */
export const GET = authed(async ({ user }) => ok(await onboardingView(user.tenantId)), "ADMIN");

/** PUT /api/onboarding { dismissed } (admins): hide the checklist, or bring it back. */
export const PUT = authed(async ({ req, user }) => {
  const { dismissed } = await readBody(req, z.object({ dismissed: z.boolean() }));
  await dismissOnboarding(user.tenantId, user.id, dismissed);
  return ok(await onboardingView(user.tenantId));
}, "ADMIN");
