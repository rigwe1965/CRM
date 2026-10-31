import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { createEntry, listEntries } from "@/lib/ai/knowledge/service";
import { knowledgeInput } from "@/lib/ai/knowledge/types";

export const dynamic = "force-dynamic";

/** GET /api/admin/knowledge: every knowledge entry of the business (policy and FAQs, active and archived). Admins only. */
export const GET = authed(async ({ user }) => ok(await listEntries(user)), "ADMIN");

/** POST /api/admin/knowledge { key, category, title, body, basis, keywords }: adds an entry. A repeated key, title or text is refused. Admins only. */
export const POST = authed(async ({ req, user }) => ok(await createEntry(user, await readBody(req, knowledgeInput)), 201), "ADMIN");
