/** Shipping status of a sold order. Pure helpers, safe to import from the browser as well as the server. */

export const FULFILMENT_STATUSES = ["NOT_STARTED", "PACKED", "SHIPPED", "DELIVERED", "RETURNED"] as const;
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number];

export const FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  NOT_STARTED: "Not started",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
};

/** Statuses an order still waits in before it leaves: what the "To ship" filter shows. */
export const TO_SHIP_STATUSES: readonly FulfilmentStatus[] = ["NOT_STARTED", "PACKED"];

/** Only a won deal is an order that gets shipped. */
export const canFulfil = (stage: string) => stage === "CLOSED_WON";

export type FulfilmentState = { fulfilmentStatus: FulfilmentStatus; shippedAt: Date | null; deliveredAt: Date | null };

/**
 * The columns to write when an order moves to `status`. Going forward fills the dates once (an earlier date is kept);
 * going back clears the dates of the steps that no longer apply, so a correction leaves no stale "delivered" date.
 * RETURNED keeps the dates: it happened after them.
 */
export function statusColumns(current: FulfilmentState, status: FulfilmentStatus, now = new Date()): FulfilmentState {
  switch (status) {
    case "NOT_STARTED":
    case "PACKED":
      return { fulfilmentStatus: status, shippedAt: null, deliveredAt: null };
    case "SHIPPED":
      return { fulfilmentStatus: status, shippedAt: current.shippedAt ?? now, deliveredAt: null };
    case "DELIVERED":
      return { fulfilmentStatus: status, shippedAt: current.shippedAt ?? now, deliveredAt: current.deliveredAt ?? now };
    case "RETURNED":
      return { fulfilmentStatus: status, shippedAt: current.shippedAt, deliveredAt: current.deliveredAt };
  }
}

const CARRIER_URLS: Record<string, ((n: string) => string) | undefined> = {
  dhl: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
};

/** Carriers with a built-in tracking page; any other name still works but has no link. */
export const KNOWN_CARRIERS = ["DHL", "UPS", "FedEx", "USPS"] as const;

/** The carrier's public tracking page for this number, or null when the carrier isn't one we know or there is no number. */
export function trackingUrl(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  const n = trackingNumber?.trim();
  const build = CARRIER_URLS[(carrier ?? "").toLowerCase().replace(/[^a-z]/g, "")];
  return build && n ? build(encodeURIComponent(n)) : null;
}
