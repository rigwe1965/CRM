import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { entryHistory, updateEntry } from "@/lib/ai/knowledge/service";
import { knowledgePatch } from "@/lib/ai/knowledge/types";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/admin/knowledge/:id: the entry's version history, newest first. Admins only. */
export const GET = authed<P>(async ({ user, params }) => ok(await entryHistory(user, params.id)), "ADMIN");

/** PATCH /api/admin/knowledge/:id { title?, body?, category?, basis?, keywords?, status? }: edits or archives (status ARCHIVED) an entry and keeps a new version. Entries are never deleted. Admins only. */
export const PATCH = authed<P>(async ({ req, user, params }) => ok(await updateEntry(user, params.id, await readBody(req, knowledgePatch))), "ADMIN");
