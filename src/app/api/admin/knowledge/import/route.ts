import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { importDefaultPolicy } from "@/lib/ai/knowledge/service";

export const dynamic = "force-dynamic";

/** POST /api/admin/knowledge/import: adds the shipped Ivycandy returns policy. Entries an admin has edited are left alone; safe to repeat. Admins only. */
export const POST = authed(async ({ user }) => ok(await importDefaultPolicy(user)), "ADMIN");
