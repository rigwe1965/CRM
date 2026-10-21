import Stripe from "stripe";
import { ApiError } from "@/lib/api";

/** Currencies customers can pay in online. Anything else is refused before a link is made. */
export const ONLINE_CURRENCIES = ["USD", "EUR"] as const;

/** Online payments are on only when both the API key and the webhook secret are set. */
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;

let client: Stripe | undefined;
let clientKey: string | undefined;

/** The Stripe client. Throws a 503 the UI can show when the keys are missing. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ApiError(503, "Online payments are not set up yet.", "PAYMENTS_NOT_CONFIGURED");
  if (!client || clientKey !== key) {
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
    clientKey = key;
  }
  return client;
}

/** 12.34 → 1234. Both online currencies have two decimals. */
export const toMinorUnits = (amount: number) => Math.round(amount * 100);
