import Stripe from "stripe";
import { ApiError } from "@/lib/api";
import { getIntegration } from "@/lib/integrations";

/** Currencies customers can pay in online. Anything else is refused before a link is made. */
export const ONLINE_CURRENCIES = ["USD", "EUR"] as const;

/** Online payments are on for a business when it has saved its Stripe keys (src/lib/integrations.ts). */
export const stripeConfigured = async (tenantId: string) => !!(await getIntegration(tenantId, "STRIPE"));

// One client per secret key, so a business's key is never used for another's requests.
const clients = new Map<string, Stripe>();

/** The business's own Stripe client. Throws a 503 the UI can show when it has no keys. */
export async function stripe(tenantId: string): Promise<Stripe> {
  const found = await getIntegration(tenantId, "STRIPE");
  if (!found) throw new ApiError(503, "Online payments are not set up yet.", "PAYMENTS_NOT_CONFIGURED");
  const key = found.settings.secretKey;
  let client = clients.get(key);
  if (!client) {
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
    clients.set(key, client);
  }
  return client;
}

/** 12.34 → 1234. Both online currencies have two decimals. */
export const toMinorUnits = (amount: number) => Math.round(amount * 100);
