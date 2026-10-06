import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { loadStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock: pieces on hand per product, colour and length (bought on invoices minus sold on
 * deal items), plus sold items that couldn't be matched to an invoice line.
 */
export const GET = authed(async ({ user }) => ok(await loadStock(ownerScope(user))));
