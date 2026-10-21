import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ONLINE_CURRENCIES, stripe, toMinorUnits } from "@/lib/stripe";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Takes the same row lock the manual payment route uses, so payments and links on one deal queue up. */
const lockDeal = (tx: Prisma.TransactionClient, dealId: string) =>
  tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${dealId} FOR UPDATE`;

export type PaymentLinkDto = {
  id: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PAID" | "CANCELLED" | "REFUND_NEEDED";
  url: string | null;
  note: string | null;
  createdAt: Date;
  paidAt: Date | null;
  createdBy: { id: string; name: string };
};

/** Links for one deal, newest first. Caller must have checked access to the deal. */
export async function paymentLinksView(dealId: string): Promise<PaymentLinkDto[]> {
  const links = await db.paymentLink.findMany({
    where: { dealId },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return links.map((l) => ({
    id: l.id,
    amount: Number(l.amount),
    currency: l.currency,
    status: l.status,
    url: l.url,
    note: l.note,
    createdAt: l.createdAt,
    paidAt: l.paidAt,
    createdBy: l.createdBy,
  }));
}

/**
 * Creates a Stripe payment link for part of a deal's balance. Pending links reserve their amount, so
 * paid + pending links can never exceed the deal total. The row is committed first (reserving the
 * amount), then Stripe is called outside the lock; if Stripe fails the reservation is released.
 */
export async function createPaymentLink(
  user: { id: string },
  deal: { id: string; title: string },
  input: { amount?: number; note?: string | null },
  baseUrl: string,
) {
  const link = await db.$transaction(async (tx) => {
    await lockDeal(tx, deal.id);
    const fresh = await tx.deal.findUnique({ where: { id: deal.id }, select: { amount: true, currency: true, deletedAt: true } });
    if (!fresh || fresh.deletedAt) throw new ApiError(404, "Deal not found", "NOT_FOUND");
    if (!(ONLINE_CURRENCIES as readonly string[]).includes(fresh.currency)) {
      throw new ApiError(422, `Online payment supports ${ONLINE_CURRENCIES.join(" and ")} only; this deal is in ${fresh.currency}.`, "CURRENCY_NOT_SUPPORTED");
    }
    const [paid, reserved] = await Promise.all([
      tx.payment.aggregate({ where: { dealId: deal.id }, _sum: { amount: true } }),
      tx.paymentLink.aggregate({ where: { dealId: deal.id, status: "PENDING" }, _sum: { amount: true } }),
    ]);
    const available = round2(Number(fresh.amount) - Number(paid._sum.amount ?? 0) - Number(reserved._sum.amount ?? 0));
    if (available <= 0) {
      throw new ApiError(422, "Nothing left to collect: the balance is paid or already covered by open payment links.", "NOTHING_TO_COLLECT");
    }
    const amount = input.amount ?? available;
    if (amount > available) {
      const msg = `Exceeds what is left to collect (${available.toFixed(2)} ${fresh.currency})`;
      throw new ApiError(422, msg, "VALIDATION_ERROR", { amount: [msg] });
    }
    return tx.paymentLink.create({
      data: { dealId: deal.id, amount, currency: fresh.currency, note: input.note ?? null, createdById: user.id },
    });
  });

  try {
    const metadata = { paymentLinkId: link.id, dealId: deal.id };
    const created = await stripe().paymentLinks.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: link.currency.toLowerCase(),
            unit_amount: toMinorUnits(Number(link.amount)),
            product_data: { name: `Payment for ${deal.title}`.slice(0, 250) },
          },
        },
      ],
      // One payment per link: a second customer attempt is refused by Stripe.
      restrictions: { completed_sessions: { limit: 1 } },
      after_completion: { type: "redirect", redirect: { url: `${baseUrl}/pay/result?status=success` } },
      metadata,
      payment_intent_data: { metadata },
    });
    return await db.paymentLink.update({ where: { id: link.id }, data: { providerLinkId: created.id, url: created.url } });
  } catch (e) {
    // Release the reservation so the amount can be collected another way.
    await db.paymentLink.update({ where: { id: link.id }, data: { status: "CANCELLED" } }).catch(() => undefined);
    console.error("stripe payment link failed", e instanceof Error ? e.message : e);
    throw new ApiError(502, "The payment link could not be created. Please try again.", "PAYMENT_PROVIDER_FAILED");
  }
}

/** Cancels a pending link. The Stripe link is switched off first, so a customer can't pay a link we think is gone. */
export async function cancelPaymentLink(dealId: string, linkId: string) {
  const link = await db.paymentLink.findFirst({ where: { id: linkId, dealId } });
  if (!link) throw new ApiError(404, "Payment link not found", "NOT_FOUND");
  if (link.status !== "PENDING") throw new ApiError(409, "Only an open payment link can be cancelled.", "LINK_NOT_OPEN");
  if (link.providerLinkId) {
    try {
      await stripe().paymentLinks.update(link.providerLinkId, { active: false });
    } catch (e) {
      console.error("stripe payment link deactivate failed", e instanceof Error ? e.message : e);
      throw new ApiError(502, "The link could not be switched off at Stripe. It is still open; please try again.", "PAYMENT_PROVIDER_FAILED");
    }
  }
  const { count } = await db.paymentLink.updateMany({ where: { id: link.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  // Paid in the instant between the check and the update: the webhook owns it now.
  if (count === 0) throw new ApiError(409, "This link was just paid, so it can't be cancelled.", "LINK_NOT_OPEN");
}

export type OnlinePaymentOutcome = "recorded" | "duplicate" | "refund_needed" | "unknown_link" | "not_paid";

/**
 * Handles a paid Stripe Checkout Session coming from one of our payment links. Safe to call any number
 * of times for the same session. The money has already been taken, so when it can't be recorded
 * (the balance dropped, the link was cancelled, the deal was deleted) it is never silently dropped:
 * the link is marked REFUND_NEEDED and the deal owner gets an urgent task.
 */
export async function recordOnlinePayment(session: Stripe.Checkout.Session): Promise<{ outcome: OnlinePaymentOutcome; dealId?: string; summary?: string }> {
  if (session.payment_status !== "paid") return { outcome: "not_paid" };
  const providerLinkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!providerLinkId || !intent) return { outcome: "unknown_link" };

  const found = await db.paymentLink.findUnique({ where: { providerLinkId }, select: { id: true, dealId: true } });
  if (!found) return { outcome: "unknown_link" };

  const paid = round2((session.amount_total ?? 0) / 100);
  const currency = (session.currency ?? "").toUpperCase();

  return db.$transaction(async (tx) => {
    await lockDeal(tx, found.dealId);
    const link = await tx.paymentLink.findUniqueOrThrow({ where: { id: found.id } });
    const already = await tx.payment.findUnique({ where: { providerRef: intent }, select: { id: true } });
    if (already || link.status === "PAID") return { outcome: "duplicate" as const, dealId: link.dealId };

    const deal = await tx.deal.findUnique({
      where: { id: link.dealId },
      select: { id: true, title: true, amount: true, currency: true, ownerId: true, contactId: true, deletedAt: true },
    });
    const sum = await tx.payment.aggregate({ where: { dealId: link.dealId }, _sum: { amount: true } });
    const balance = deal ? round2(Number(deal.amount) - Number(sum._sum.amount ?? 0)) : 0;

    const problem =
      !deal || deal.deletedAt ? "the deal no longer exists"
      : link.status !== "PENDING" ? "the link had been cancelled"
      : currency !== deal.currency || paid !== Number(link.amount) ? "the amount or currency did not match the link"
      : paid > balance ? `the deal balance is now only ${balance.toFixed(2)} ${deal.currency}`
      : null;

    if (problem || !deal) {
      await tx.paymentLink.update({ where: { id: link.id }, data: { status: "REFUND_NEEDED", paidAt: new Date() } });
      if (deal) {
        await tx.task.create({
          data: {
            title: `Refund online payment of ${paid.toFixed(2)} ${currency}`,
            description: `A customer paid "${deal.title}" online, but it could not be recorded because ${problem}. Refund it in the Stripe dashboard (payment ${intent}).`,
            priority: "URGENT",
            dueDate: new Date(),
            assigneeId: deal.ownerId,
            createdById: deal.ownerId,
            dealId: deal.id,
            contactId: deal.contactId,
          },
        });
      }
      return { outcome: "refund_needed" as const, dealId: link.dealId, summary: `${paid.toFixed(2)} ${currency}: ${problem}` };
    }

    await tx.payment.create({
      data: {
        dealId: deal.id,
        amount: paid,
        paidAt: new Date(),
        method: "DIGITAL",
        reference: intent,
        note: "Paid online via payment link",
        source: "ONLINE",
        providerRef: intent,
        paymentLinkId: link.id,
      },
    });
    await tx.paymentLink.update({ where: { id: link.id }, data: { status: "PAID", paidAt: new Date() } });
    return { outcome: "recorded" as const, dealId: deal.id, summary: `${paid.toFixed(2)} ${currency}` };
  });
}

/** Writes the audit entry for a webhook outcome (no signed-in user: the actor is Stripe). */
export const auditOnline = (action: string, dealId: string | undefined, summary: string | undefined, data?: unknown) =>
  audit({ email: "stripe-webhook" }, { action, entity: "deal", entityId: dealId, summary, data });
