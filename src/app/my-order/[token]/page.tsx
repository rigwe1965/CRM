import type { Metadata } from "next";
import { CheckCircle2, LinkIcon } from "lucide-react";
import { formatAmount } from "@/lib/email-templates";
import { resolveOrderLink } from "@/lib/order-links";
import { customerOrderView } from "@/lib/customer-order";

export const dynamic = "force-dynamic";

// The address is a credential: keep it out of search engines and out of the Referer header sent to other sites.
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" };

const day = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d);

const STATE: Record<"PAID" | "PART_PAID" | "OVERDUE" | "UPCOMING", { label: string; cls: string }> = {
  PAID: { label: "Paid", cls: "bg-emerald-100 text-emerald-800" },
  PART_PAID: { label: "Part paid", cls: "bg-amber-100 text-amber-800" },
  OVERDUE: { label: "Overdue", cls: "bg-red-100 text-red-800" },
  UPCOMING: { label: "Upcoming", cls: "bg-slate-100 text-slate-700" },
};

function Closed() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <LinkIcon className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">This link is not working</h1>
        <p className="text-sm text-muted-foreground">It may have expired or been replaced. Please ask the business that sent it for a new link.</p>
      </div>
    </main>
  );
}

/** A customer's private view of one order: what was ordered, what has been paid and what is due, with a Pay now button. */
export default async function MyOrderPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ pay?: string }> }) {
  const [{ token }, { pay }] = await Promise.all([params, searchParams]);
  const link = await resolveOrderLink(token);
  const o = link && (await customerOrderView(link.tenantId, link.dealId, link.linkId));
  if (!link || !o) return <Closed />;

  const cur = (n: number) => formatAmount(n, o.currency);
  const settled = o.balance <= 0;

  return (
    <main className="mx-auto min-h-screen max-w-xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{o.brand}</p>
        <h1 className="text-2xl font-semibold">{o.title}</h1>
        <p className="text-sm text-muted-foreground">
          {o.firstName ? `Hi ${o.firstName}. ` : ""}Ordered on {day(o.orderedOn)}.
        </p>
      </header>

      <section aria-label="Totals" className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Total", cur(o.total)],
          ["Paid", cur(o.paid)],
          ["Balance", cur(o.balance)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-base font-semibold tabular-nums sm:text-lg">{value}</p>
          </div>
        ))}
      </section>

      {settled ? (
        <p className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> This order is fully paid. Thank you!
        </p>
      ) : o.canPayOnline ? (
        <form method="post" action={`/api/public/my-order/${token}/pay`} className="space-y-2">
          <button type="submit" className="w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:opacity-90">
            Pay {cur(o.payAmount)} now
          </button>
          <p className="text-center text-xs text-muted-foreground">You will go to our payment provider&apos;s secure page to pay by card.</p>
        </form>
      ) : (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          {cur(o.payAmount || o.balance)} is still to pay. Online payment is not available for this order, so please contact {o.brand} to arrange payment.
        </p>
      )}
      {pay === "unavailable" && !settled && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          We couldn&apos;t open the payment page just now. Please try again in a moment, or contact {o.brand}.
        </p>
      )}

      {o.shipping && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Delivery</h2>
          <div className="space-y-1 rounded-lg border p-3 text-sm">
            <p className="font-medium">{o.shipping.label}</p>
            {o.shipping.shippedAt && <p className="text-muted-foreground">Shipped {day(o.shipping.shippedAt)}</p>}
            {o.shipping.deliveredAt && <p className="text-muted-foreground">Delivered {day(o.shipping.deliveredAt)}</p>}
            {o.shipping.trackingNumber && (
              <p>
                {o.shipping.carrier ? `${o.shipping.carrier} · ` : ""}tracking <span className="font-mono">{o.shipping.trackingNumber}</span>
              </p>
            )}
            {o.shipping.trackingUrl && (
              <a href={o.shipping.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-block font-medium text-primary underline">
                Track your parcel
              </a>
            )}
          </div>
        </section>
      )}

      {o.items.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Your order</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {o.items.map((i, n) => (
              <li key={n} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  {i.description} <span className="text-muted-foreground">× {i.quantity}</span>
                </span>
                <span className="tabular-nums">{cur(i.unitPrice * i.quantity)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.instalments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Payment plan</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {o.instalments.map((i, n) => (
              <li key={n} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  <span className="text-muted-foreground">#{n + 1}</span> · {day(i.dueDate)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{cur(i.amount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE[i.state].cls}`}>{STATE[i.state].label}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.payments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Payments received</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {o.payments.map((p, n) => (
              <li key={n} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{day(p.paidAt)}</span>
                <span className="tabular-nums">{cur(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
