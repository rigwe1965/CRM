"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MessageCircle, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/page";
import { dateOnly } from "@/lib/client/format";
import { useItem, useList, useSetFulfilment, useWhatsappStatus } from "@/lib/client/hooks";
import type { Contact, Deal } from "@/lib/client/types";
import { FULFILMENT_LABEL, FULFILMENT_STATUSES, KNOWN_CARRIERS, trackingUrl, type FulfilmentStatus } from "@/lib/fulfilment";
import { cn } from "@/lib/utils";
import { nullable, useFormState } from "./form-kit";
import { WhatsappReplyDialog } from "./whatsapp-reply-dialog";

export const FULFILMENT_TONE: Record<FulfilmentStatus, "secondary" | "warning" | "success" | "destructive"> = {
  NOT_STARTED: "secondary",
  PACKED: "warning",
  SHIPPED: "warning",
  DELIVERED: "success",
  RETURNED: "destructive",
};

export function FulfilmentDialog({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">{deal && <FulfilmentBody deal={deal} />}</DialogContent>
    </Dialog>
  );
}

/** The next step button for each status; the stepper above it lets staff jump to any step to correct a mistake. */
const NEXT: Partial<Record<FulfilmentStatus, { to: FulfilmentStatus; label: string }>> = {
  NOT_STARTED: { to: "PACKED", label: "Mark packed" },
  PACKED: { to: "SHIPPED", label: "Mark shipped" },
  SHIPPED: { to: "DELIVERED", label: "Mark delivered" },
};

/**
 * Opens the WhatsApp dialog on its Template tab with this order already chosen, so its tracking number fills itself in.
 * A person still reads the preview and presses Send. Says why when the customer can't be messaged on WhatsApp.
 */
function ShippingUpdate({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const contactId = deal.contactId ?? "";
  const contact = useItem<Contact>("contacts", contactId);
  const status = useWhatsappStatus(contactId);
  const orders = useList<Deal>("deals", { contactId, pageSize: 50 }, !!contactId);
  if (contact.isLoading || status.isLoading || orders.isLoading) return null;
  if (!contact.data || !status.data?.canTemplate) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Can&apos;t send on WhatsApp</DialogTitle>
            <DialogDescription>
              A template needs WhatsApp set up in Settings → Integrations, a WhatsApp-ready phone number, and the customer&apos;s OK to WhatsApp (tick it on their contact).
            </DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <WhatsappReplyDialog
      contact={contact.data}
      deals={orders.data?.data ?? [deal]}
      canText={status.data.canSend}
      canTemplate
      initialDealId={deal.id}
      startWithTemplate
      onClose={onClose}
    />
  );
}

function FulfilmentBody({ deal }: { deal: Deal }) {
  const [messaging, setMessaging] = useState(false);
  const set = useSetFulfilment(deal.id);
  const form = useFormState();
  const [carrier, setCarrier] = useState(deal.carrier ?? "");
  const [tracking, setTracking] = useState(deal.trackingNumber ?? "");
  useEffect(() => {
    setCarrier(deal.carrier ?? "");
    setTracking(deal.trackingNumber ?? "");
  }, [deal.carrier, deal.trackingNumber]);

  const won = deal.stage === "CLOSED_WON";
  const next = NEXT[deal.fulfilmentStatus];
  const link = trackingUrl(deal.carrier, deal.trackingNumber);
  const trackingDirty = (nullable(carrier) ?? null) !== deal.carrier || (nullable(tracking) ?? null) !== deal.trackingNumber;

  const save = (body: { status?: FulfilmentStatus; carrier?: string | null; trackingNumber?: string | null }, done: string) => {
    let sent = false;
    return form
      .run(async () => {
        const res = (await set.mutateAsync(body)) as { data?: { shippingUpdate?: string } } | undefined;
        sent = res?.data?.shippingUpdate === "SENT";
      })
      .then((ok) => {
        if (!ok) return;
        if (sent) toast.success(`${done}. The customer was sent an update on WhatsApp.`);
        else toast.success(done, body.status === "SHIPPED" && deal.contactId ? { action: { label: "Send shipping update", onClick: () => setMessaging(true) } } : undefined);
      });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Shipping · {deal.title}</DialogTitle>
        <DialogDescription>Where this order is on its way to the customer.</DialogDescription>
      </DialogHeader>
      {!won ? (
        <p className="text-sm text-muted-foreground">Only a won order can be shipped. Move this deal to Closed won first.</p>
      ) : (
        <div className="space-y-5">
          <ol className="flex flex-wrap gap-2" aria-label="Shipping steps">
            {FULFILMENT_STATUSES.filter((s) => s !== "RETURNED" || deal.fulfilmentStatus === "RETURNED" || deal.fulfilmentStatus === "DELIVERED" || deal.fulfilmentStatus === "SHIPPED").map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={set.isPending || s === deal.fulfilmentStatus}
                  aria-current={s === deal.fulfilmentStatus ? "step" : undefined}
                  onClick={() => save({ status: s }, `Marked ${FULFILMENT_LABEL[s].toLowerCase()}`)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    s === deal.fulfilmentStatus ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted disabled:opacity-60",
                  )}
                >
                  {FULFILMENT_LABEL[s]}
                </button>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            {deal.shippedAt ? `Shipped ${dateOnly(deal.shippedAt)}` : "Not shipped yet"}
            {deal.deliveredAt ? ` · delivered ${dateOnly(deal.deliveredAt)}` : ""}
          </p>

          {form.formError && <p role="alert" className="text-xs text-destructive">{form.formError}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Carrier" error={form.err("carrier")}>
              <Input list="carriers" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="DHL, UPS, FedEx, USPS…" />
              <datalist id="carriers">
                {KNOWN_CARRIERS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FormField>
            <FormField label="Tracking number" error={form.err("trackingNumber")}>
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={set.isPending || !trackingDirty} onClick={() => save({ carrier: nullable(carrier), trackingNumber: nullable(tracking) }, "Tracking saved")}>
              Save tracking
            </Button>
            {link && (
              <Button variant="ghost" size="sm" asChild>
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open carrier tracking
                </a>
              </Button>
            )}
            {!link && deal.trackingNumber && <span className="text-xs text-muted-foreground">No tracking page for this carrier.</span>}
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Badge variant={FULFILMENT_TONE[deal.fulfilmentStatus]}>{FULFILMENT_LABEL[deal.fulfilmentStatus]}</Badge>
            <div className="flex flex-wrap justify-end gap-2">
            {deal.contactId && (deal.fulfilmentStatus === "SHIPPED" || deal.fulfilmentStatus === "DELIVERED") && (
              <Button type="button" variant="outline" onClick={() => setMessaging(true)}>
                <MessageCircle /> Send shipping update
              </Button>
            )}
            {next && (
              <Button type="button" disabled={set.isPending} onClick={() => save({ status: next.to, ...(trackingDirty && { carrier: nullable(carrier), trackingNumber: nullable(tracking) }) }, `Marked ${FULFILMENT_LABEL[next.to].toLowerCase()}`)}>
                <Truck /> {next.label}
              </Button>
            )}
            </div>
          </div>
        </div>
      )}
      {messaging && <ShippingUpdate deal={deal} onClose={() => setMessaging(false)} />}
    </>
  );
}
