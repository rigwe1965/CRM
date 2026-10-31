import { db } from "@/lib/db";
import { withTenant } from "@/lib/tenant-context";
import { appUrl } from "@/lib/mail";
import { dealPaymentsView } from "@/lib/payments";
import { reminderPayLink } from "@/lib/payment-links";
import { ONLINE_CURRENCIES, stripeConfigured } from "@/lib/stripe";
import { recordOrderLinkView } from "@/lib/order-links";
import { FULFILMENT_LABEL, trackingUrl } from "@/lib/fulfilment";

/**
 * What a customer sees on their private order page (Plan A). Built field by field from an allow-list: no owner, no
 * staff names, no internal notes, no other customers. Runs as the business named by the link (`withTenant`).
 */
export type CustomerOrderView = {
  brand: string;
  firstName: string | null;
  title: string;
  orderedOn: Date;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  items: { description: string; quantity: number; unitPrice: number }[];
  instalments: { dueDate: Date; amount: number; state: "PAID" | "PART_PAID" | "OVERDUE" | "UPCOMING" }[];
  payments: { paidAt: Date; amount: number }[];
  /** What the Pay now button collects: the next instalment's unpaid part, or the whole balance. 0 when nothing is owed. */
  payAmount: number;
  canPayOnline: boolean;
  /** Where the parcel is, once the order has started shipping; null before that. The tracking link only exists for carriers we know. */
  shipping: { label: string; delivered: boolean; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: Date | null; deliveredAt: Date | null } | null;
};

const describe = (i: { productType: string; texture: string | null; lengthInches: string | null; color: string | null; laceType: string | null }) =>
  [i.productType, i.texture, i.lengthInches ? `${i.lengthInches}"` : null, i.color, i.laceType].filter(Boolean).join(" · ");

/** The page's data, or null if the order has vanished since the link was checked. */
export async function customerOrderView(tenantId: string, dealId: string, linkId?: string): Promise<CustomerOrderView | null> {
  return withTenant(tenantId, async () => {
    const [tenant, deal, items] = await Promise.all([
      db.tenant.findFirst({ where: { id: tenantId }, select: { name: true, brandName: true } }),
      db.deal.findFirst({
        where: { id: dealId, tenantId, deletedAt: null },
        select: { id: true, title: true, amount: true, currency: true, createdAt: true, fulfilmentStatus: true, carrier: true, trackingNumber: true, shippedAt: true, deliveredAt: true, contact: { select: { firstName: true } } },
      }),
      db.dealItem.findMany({ where: { tenantId, dealId }, orderBy: { position: "asc" } }),
    ]);
    if (!tenant || !deal) return null;
    if (linkId) await recordOrderLinkView(tenantId, linkId);

    const view = await dealPaymentsView({ id: deal.id, amount: deal.amount, currency: deal.currency });
    const balance = Math.max(view.summary.balance, 0);
    const payAmount = balance > 0 ? view.summary.nextDue?.amount ?? balance : 0;
    const online = (ONLINE_CURRENCIES as readonly string[]).includes(deal.currency) && payAmount > 0 && (await stripeConfigured(tenantId));

    return {
      brand: tenant.brandName || tenant.name,
      firstName: deal.contact?.firstName ?? null,
      title: deal.title,
      orderedOn: deal.createdAt,
      currency: deal.currency,
      total: view.dealAmount,
      paid: view.summary.paid,
      balance,
      items: items.map((i) => ({ description: describe(i), quantity: i.quantity, unitPrice: Number(i.unitPrice) })),
      instalments: view.instalments.map((i) => ({
        dueDate: i.dueDate,
        amount: i.amount,
        state: i.covered >= i.amount ? "PAID" : i.overdue ? "OVERDUE" : i.covered > 0 ? "PART_PAID" : "UPCOMING",
      })),
      payments: view.payments.map((p) => ({ paidAt: p.paidAt, amount: p.amount })),
      payAmount,
      canPayOnline: online,
      shipping:
        deal.fulfilmentStatus === "NOT_STARTED"
          ? null
          : {
              label: FULFILMENT_LABEL[deal.fulfilmentStatus],
              delivered: deal.fulfilmentStatus === "DELIVERED",
              carrier: deal.carrier,
              trackingNumber: deal.trackingNumber,
              trackingUrl: trackingUrl(deal.carrier, deal.trackingNumber),
              shippedAt: deal.shippedAt,
              deliveredAt: deal.deliveredAt,
            },
    };
  });
}

/**
 * The Stripe address for the customer's Pay now button: the open payment link for exactly the amount due, or a new
 * one. Null when online payment is not possible right now (nothing owed, no Stripe, a currency Stripe is not used
 * for, the balance already covered by open links); the page then tells the customer to contact the business.
 */
export async function customerPayUrl(link: { tenantId: string; dealId: string; linkId: string }): Promise<string | null> {
  const { tenantId, dealId, linkId } = link;
  return withTenant(tenantId, async () => {
    const [deal, row] = await Promise.all([
      db.deal.findFirst({ where: { id: dealId, tenantId, deletedAt: null }, select: { id: true, title: true, amount: true, currency: true } }),
      // The link's creator is the account the new payment link is filed under.
      db.customerOrderLink.findFirst({ where: { id: linkId, tenantId, dealId }, select: { createdBy: { select: { id: true, email: true } } } }),
    ]);
    if (!deal || !row) return null;
    const view = await dealPaymentsView({ id: deal.id, amount: deal.amount, currency: deal.currency });
    const amount = view.summary.balance > 0 ? view.summary.nextDue?.amount ?? view.summary.balance : 0;
    if (amount <= 0) return null;
    return reminderPayLink({ id: row.createdBy.id, tenantId, email: row.createdBy.email }, { id: deal.id, title: deal.title }, amount, deal.currency, appUrl());
  });
}
