"use client";

import { useState } from "react";
import { addMonths, addWeeks, format, parseISO } from "date-fns";
import { Copy, Mail, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { PdfButton } from "@/components/export/export-menu";
import { useCurrentUser } from "@/components/providers";
import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/client/constants";
import { dateOnly, money, toDateInput } from "@/lib/client/format";
import {
  errorMessage,
  useAddPayment,
  useCancelPaymentLink,
  useCreateCustomerLink,
  useCreatePaymentLink,
  useCustomerLink,
  useDeletePayment,
  useItem,
  usePaymentLinks,
  usePayments,
  useReminders,
  useRevokeCustomerLink,
  useSave,
  useSaveSchedule,
  useSendContactEmail,
  useSendReminder,
} from "@/lib/client/hooks";
import type { Activity, Contact, Deal, InstalmentStatus, PaymentLink, PaymentMethod, PaymentsView, ReminderKind } from "@/lib/client/types";
import { whatsappUrl } from "@/lib/client/whatsapp";
import { cn } from "@/lib/utils";
import { nullable, useFormState } from "./form-kit";

export function PaymentsDialog({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">{deal && <PaymentsBody deal={deal} />}</DialogContent>
    </Dialog>
  );
}

const today = () => format(new Date(), "yyyy-MM-dd");

function PaymentsBody({ deal }: { deal: Deal }) {
  const { data, isLoading, error, refetch } = usePayments(deal.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Payments · {deal.title}</DialogTitle>
        <DialogDescription>Record money received and, if you like, agree due dates for instalments.</DialogDescription>
        <div>
          <PdfButton entity="deals" id={deal.id} label="Download statement (PDF)" />
        </div>
      </DialogHeader>
      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      ) : error || !data ? (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      ) : (
        <PaymentsContent deal={deal} view={data} />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
    </div>
  );
}

function WhatsAppReminder({ deal, view, contactId }: { deal: Deal; view: PaymentsView; contactId: string }) {
  const { data: contact } = useItem<Contact>("contacts", contactId);
  const log = useSave<Activity>("activities");
  const { summary } = view;
  if (!contact?.phoneE164 || summary.balance <= 0) return null;

  const amount = money(summary.nextDue?.amount ?? summary.balance, view.currency);
  const text = summary.nextDue
    ? `Hi ${contact.firstName}, a friendly reminder that your ${amount} instalment for "${deal.title}" is due on ${dateOnly(summary.nextDue.dueDate)}. Thank you!`
    : `Hi ${contact.firstName}, a friendly reminder that ${amount} is still outstanding for "${deal.title}". Thank you!`;

  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={whatsappUrl(contact.phoneE164, text)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          toast("WhatsApp opened in a new tab", {
            action: {
              label: "Log message",
              onClick: () =>
                log.mutate(
                  { type: "WHATSAPP", direction: "OUT", subject: "Payment reminder", body: text, contactId, dealId: deal.id },
                  { onSuccess: () => toast.success("WhatsApp message logged"), onError: (e) => toast.error(errorMessage(e)) },
                ),
            },
          })
        }
      >
        <MessageCircle /> Remind on WhatsApp
      </a>
    </Button>
  );
}

const LINK_STATUS: Record<PaymentLink["status"], { label: string; tone: "secondary" | "success" | "destructive" | "warning" }> = {
  PENDING: { label: "Open", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "secondary" },
  REFUND_NEEDED: { label: "Refund needed", tone: "destructive" },
};

function PaymentLinksSection({ deal, view }: { deal: Deal; view: PaymentsView }) {
  const { data, isLoading, error } = usePaymentLinks(deal.id);
  const create = useCreatePaymentLink(deal.id);
  const cancel = useCancelPaymentLink(deal.id);
  const form = useFormState();
  const { data: contact } = useItem<Contact>("contacts", deal.contactId ?? "");
  const sendEmail = useSendContactEmail(deal.contactId ?? "");
  const log = useSave<Activity>("activities");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const supported = deal.currency === "USD" || deal.currency === "EUR";
  const suggested = view.summary.nextDue?.amount ?? view.summary.balance;
  const messageFor = (url: string, linkAmount: number) =>
    `Hi ${contact?.firstName ?? "there"}, here is your secure link to pay ${money(linkAmount, view.currency)} for "${deal.title}": ${url}`;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Payment links</h3>
      {isLoading ? (
        <Skeleton className="h-12" />
      ) : error || !data ? (
        <p className="text-sm text-destructive">Could not load payment links.</p>
      ) : !data.configured ? (
        <p className="text-sm text-muted-foreground">Online payment is not set up yet. Ask your technician to add the Stripe keys (see TECHNICIAN.md).</p>
      ) : (
        <>
          {data.links.length > 0 && (
            <ul className="divide-y rounded-md border">
              {data.links.map((l) => {
                const st = LINK_STATUS[l.status];
                return (
                  <li key={l.id} className="space-y-2 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium tabular-nums">{money(l.amount, l.currency)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {dateOnly(l.createdAt)} · {l.createdBy.name}
                          {l.note ? ` · ${l.note}` : ""}
                        </p>
                      </div>
                      <Badge variant={st.tone}>{st.label}</Badge>
                    </div>
                    {l.status === "REFUND_NEEDED" && (
                      <p className="text-xs text-destructive">Paid, but it could not be recorded. A task was created to refund it in Stripe.</p>
                    )}
                    {l.status === "PENDING" && l.url && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => copy(l.url!)}>
                          <Copy /> Copy link
                        </Button>
                        {contact?.phoneE164 && (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={whatsappUrl(contact.phoneE164, messageFor(l.url, l.amount))}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                toast("WhatsApp opened in a new tab", {
                                  action: {
                                    label: "Log message",
                                    onClick: () =>
                                      log.mutate(
                                        { type: "WHATSAPP", direction: "OUT", subject: "Payment link sent", body: messageFor(l.url!, l.amount), contactId: contact.id, dealId: deal.id },
                                        { onSuccess: () => toast.success("WhatsApp message logged"), onError: (e) => toast.error(errorMessage(e)) },
                                      ),
                                  },
                                })
                              }
                            >
                              <MessageCircle /> Send on WhatsApp
                            </a>
                          </Button>
                        )}
                        {contact?.email && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={sendEmail.isPending}
                            onClick={() =>
                              sendEmail.mutate(
                                { subject: `Payment link for ${deal.title}`.slice(0, 200), message: messageFor(l.url!, l.amount) },
                                { onSuccess: () => toast.success(`Email sent to ${contact.email}`), onError: (e) => toast.error(errorMessage(e)) },
                              )
                            }
                          >
                            <Mail /> Email link
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={cancel.isPending}
                          onClick={() =>
                            cancel.mutate(l.id, {
                              onSuccess: () => toast.success("Link cancelled"),
                              onError: (e) => toast.error(errorMessage(e)),
                            })
                          }
                        >
                          Cancel link
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {view.summary.balance > 0 &&
            (supported ? (
              <form
                noValidate
                className="space-y-3 rounded-md border bg-muted/30 p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await form.run(() =>
                    create.mutateAsync({ amount: amount.trim() === "" ? undefined : Number(amount), note: nullable(note) }),
                  );
                  if (ok) {
                    toast.success("Payment link created");
                    setAmount("");
                    setNote("");
                  }
                }}
              >
                <p className="text-sm font-medium">New payment link</p>
                {form.formError && !form.err("amount") && <p role="alert" className="text-xs text-destructive">{form.formError}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={`Amount (${view.currency})`} error={form.err("amount")}>
                    <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(suggested)} />
                  </FormField>
                  <FormField label="Note (optional)" error={form.err("note")}>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Instalment 2" />
                  </FormField>
                </div>
                <Button type="submit" size="sm" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create payment link"}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Online payment supports USD and EUR deals only; this deal is in {deal.currency}.</p>
            ))}
        </>
      )}
    </section>
  );
}

function CustomerLinkSection({ deal }: { deal: Deal }) {
  const { data: link, isLoading, error } = useCustomerLink(deal.id);
  const create = useCreateCustomerLink(deal.id);
  const revoke = useRevokeCustomerLink(deal.id);
  const { data: contact } = useItem<Contact>("contacts", deal.contactId ?? "");
  const active = link?.status === "ACTIVE" && link.url ? link : null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Customer order page</h3>
      <p className="text-xs text-muted-foreground">A private link where the customer sees this order, what they have paid and what is due, and can pay online.</p>
      {isLoading ? (
        <Skeleton className="h-12" />
      ) : error ? (
        <p className="text-sm text-destructive">Could not load the customer link.</p>
      ) : (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          {active ? (
            <>
              <p className="break-all text-xs">{active.url}</p>
              <p className="text-xs text-muted-foreground">
                Valid until {dateOnly(active.expiresAt)} · opened {active.viewCount} {active.viewCount === 1 ? "time" : "times"}
                {active.lastViewedAt ? `, last on ${dateOnly(active.lastViewedAt)}` : ""}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {link?.status === "EXPIRED" ? "The last link expired." : link?.status === "REVOKED" ? "The link is switched off." : "No link yet."} Make a new one to share this order.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {active && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => copy(active.url!)}>
                  <Copy /> Copy customer link
                </Button>
                {contact?.email && (
                  <SendCustomerLink deal={deal} url={active.url!} contactId={contact.id} email={contact.email} />
                )}
              </>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={create.isPending}
              onClick={() => {
                if (active && !window.confirm("The old link will stop working at once. Make a new one?")) return;
                create.mutate(undefined, { onSuccess: () => toast.success("New customer link made"), onError: (e) => toast.error(errorMessage(e)) });
              }}
            >
              {active ? "Regenerate" : "Make customer link"}
            </Button>
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(undefined, { onSuccess: () => toast.success("Customer link switched off"), onError: (e) => toast.error(errorMessage(e)) })}
              >
                Switch off
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SendCustomerLink({ deal, url, contactId, email }: { deal: Deal; url: string; contactId: string; email: string }) {
  const sendEmail = useSendContactEmail(contactId);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={sendEmail.isPending}
      onClick={() =>
        sendEmail.mutate(
          { subject: `Your order: ${deal.title}`.slice(0, 200), message: `Here is the private page for your order "${deal.title}", where you can see what is due and pay online: ${url}` },
          { onSuccess: () => toast.success(`Email sent to ${email}`), onError: (e) => toast.error(errorMessage(e)) },
        )
      }
    >
      <Mail /> Email link
    </Button>
  );
}

const REMINDER_LABEL: Record<ReminderKind, string> = { UPCOMING: "Due soon", OVERDUE_1: "Overdue", OVERDUE_2: "Second overdue" };

function RemindersSection({ deal, view }: { deal: Deal; view: PaymentsView }) {
  const { data, isLoading, error } = useReminders(deal.id);
  const send = useSendReminder(deal.id);
  const unpaid = view.instalments.filter((i) => i.covered < i.amount);
  const cur = (n: number) => money(n, view.currency);

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Payment reminders</h3>
      {isLoading ? (
        <Skeleton className="h-12" />
      ) : error || !data ? (
        <p className="text-sm text-destructive">Could not load reminders.</p>
      ) : (
        <>
          {data.mode === "TEST" && (
            <p className="text-xs text-muted-foreground">Reminder emails are in test mode: they go to your test address, not to the customer. An admin switches them to Live in Settings → Automations.</p>
          )}
          {!data.canEmail && <p className="text-xs text-muted-foreground">This customer has no email address, or has asked not to be emailed.</p>}
          {!data.canWhatsapp && (
            <p className="text-xs text-muted-foreground">WhatsApp reminders need a WhatsApp-ready phone number, the customer&apos;s OK to WhatsApp (tick it on their contact), and WhatsApp set up in Settings → Integrations.</p>
          )}
          {unpaid.length > 0 && (data.canEmail || data.canWhatsapp) && (
            <ul className="divide-y rounded-md border">
              {unpaid.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="text-muted-foreground">#{i.position}</span> · {dateOnly(i.dueDate)} · <span className="tabular-nums">{cur(i.amount - i.covered)}</span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-2">
                    {data.canEmail && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={send.isPending}
                        onClick={() =>
                          send.mutate(
                            { instalmentId: i.id, channel: "EMAIL" },
                            {
                              onSuccess: () => toast.success(data.mode === "TEST" ? "Test reminder sent to your test address" : "Reminder emailed to the customer"),
                              onError: (e) => toast.error(errorMessage(e)),
                            },
                          )
                        }
                      >
                        <Mail /> Send reminder now
                      </Button>
                    )}
                    {data.canWhatsapp && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={send.isPending}
                        onClick={() =>
                          send.mutate(
                            { instalmentId: i.id, channel: "WHATSAPP" },
                            {
                              onSuccess: () => toast.success(data.mode === "TEST" ? "Test WhatsApp reminder sent to your test number" : "Reminder sent on WhatsApp"),
                              onError: (e) => toast.error(errorMessage(e)),
                            },
                          )
                        }
                      >
                        <MessageCircle /> Send on WhatsApp
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reminders sent yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {data.reminders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {REMINDER_LABEL[r.kind]} · instalment #{r.position}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dateOnly(r.sentAt)} · {r.channel === "WHATSAPP" ? "WhatsApp" : "email"} to {r.recipient}
                    </p>
                  </div>
                  {r.test && <Badge variant="secondary">Test</Badge>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function PaymentsContent({ deal, view }: { deal: Deal; view: PaymentsView }) {
  const dealId = deal.id;
  const cur = (n: number) => money(n, view.currency);
  const { summary } = view;
  const settled = summary.balance <= 0;
  const del = useDeletePayment(dealId);
  // Only admins remove payments, and never one Stripe confirmed (that is refunded in Stripe).
  const canDelete = useCurrentUser().role === "ADMIN";

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Deal amount" value={cur(view.dealAmount)} />
        <Stat label="Paid" value={cur(summary.paid)} tone="good" />
        <Stat label="Balance" value={cur(summary.balance)} tone={summary.overdue ? "bad" : undefined} />
      </div>
      <p className="text-sm text-muted-foreground">
        {settled
          ? "Fully paid."
          : summary.nextDue
            ? `Next due ${dateOnly(summary.nextDue.dueDate)}: ${cur(summary.nextDue.amount)}${summary.overdue ? " (overdue)" : ""}`
            : "No schedule set. Add one below if the customer is paying in instalments."}
      </p>
      {deal.contactId && <WhatsAppReminder deal={deal} view={view} contactId={deal.contactId} />}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Payments received</h3>
        {view.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {view.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{cur(p.amount)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dateOnly(p.paidAt)} · {paymentMethodLabel(p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.note ? ` · ${p.note}` : ""} · {p.recordedBy ? `by ${p.recordedBy.name}` : "paid online"}
                  </p>
                </div>
                {canDelete && p.source !== "ONLINE" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete payment of ${cur(p.amount)}`}
                  disabled={del.isPending}
                  onClick={() =>
                    del.mutate(p.id, {
                      onSuccess: () => toast.success("Payment removed"),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <Trash2 />
                </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!settled && <AddPayment dealId={dealId} balance={summary.balance} />}
      </section>

      <CustomerLinkSection deal={deal} />

      <PaymentLinksSection deal={deal} view={view} />

      {view.instalments.length > 0 && <RemindersSection deal={deal} view={view} />}

      <ScheduleSection dealId={dealId} view={view} />
    </div>
  );
}

function AddPayment({ dealId, balance }: { dealId: string; balance: number }) {
  const add = useAddPayment(dealId);
  const form = useFormState();
  const [v, setV] = useState({ amount: "", paidAt: today(), method: "BANK_TRANSFER" as PaymentMethod, reference: "", note: "" });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  return (
    <form
      noValidate
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await form.run(() =>
          add.mutateAsync({
            amount: v.amount.trim() === "" ? undefined : Number(v.amount),
            paidAt: v.paidAt,
            method: v.method,
            reference: nullable(v.reference),
            note: nullable(v.note),
          }),
        );
        if (ok) {
          toast.success("Payment recorded");
          setV((s) => ({ ...s, amount: "", reference: "", note: "" }));
        }
      }}
    >
      <p className="text-sm font-medium">Record a payment</p>
      {form.formError && !form.err("amount") && <p role="alert" className="text-xs text-destructive">{form.formError}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Amount" error={form.err("amount")}>
          <Input type="number" min={0} step="0.01" value={v.amount} onChange={(e) => set("amount", e.target.value)} placeholder={String(balance)} />
        </FormField>
        <FormField label="Date received" error={form.err("paidAt")}>
          <Input type="date" value={v.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
        </FormField>
        <FormField label="Method">
          <Select value={v.method} onValueChange={(m) => set("method", m as PaymentMethod)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Reference (optional)" error={form.err("reference")}>
          <Input value={v.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Transfer ID, Zelle name…" />
        </FormField>
        <FormField label="Note (optional)" error={form.err("note")}>
          <Input value={v.note} onChange={(e) => set("note", e.target.value)} />
        </FormField>
      </div>
      <Button type="submit" size="sm" disabled={add.isPending}>
        {add.isPending ? "Saving…" : "Add payment"}
      </Button>
    </form>
  );
}

function InstalmentBadge({ i }: { i: InstalmentStatus }) {
  if (i.covered >= i.amount) return <Badge variant="success">Paid</Badge>;
  if (i.overdue) return <Badge variant="destructive">Overdue</Badge>;
  if (i.covered > 0) return <Badge variant="warning">Part paid</Badge>;
  return <Badge variant="secondary">Upcoming</Badge>;
}

type Row = { key: number; dueDate: string; amount: string };
let rowKey = 0;

function ScheduleSection({ dealId, view }: { dealId: string; view: PaymentsView }) {
  const [editing, setEditing] = useState(false);
  const cur = (n: number) => money(n, view.currency);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Instalment schedule</h3>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {view.instalments.length ? "Change schedule" : "Set up schedule"}
          </Button>
        )}
      </div>
      {editing ? (
        <ScheduleEditor dealId={dealId} view={view} onDone={() => setEditing(false)} />
      ) : view.instalments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No schedule. Payments just reduce the balance.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {view.instalments.map((i, n) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                <span className="text-muted-foreground">#{n + 1}</span> · {dateOnly(i.dueDate)}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{cur(i.amount)}</span>
                <InstalmentBadge i={i} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleEditor({ dealId, view, onDone }: { dealId: string; view: PaymentsView; onDone: () => void }) {
  const save = useSaveSchedule(dealId);
  const form = useFormState();
  const [rows, setRows] = useState<Row[]>(() =>
    view.instalments.map((i) => ({ key: rowKey++, dueDate: toDateInput(i.dueDate), amount: String(i.amount) })),
  );
  const [gen, setGen] = useState({ count: "3", first: today(), every: "month" as "month" | "week" });

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  function generate() {
    const count = Math.max(1, Math.min(60, Math.floor(Number(gen.count) || 0)));
    if (!gen.first) return;
    const cents = Math.round(view.dealAmount * 100);
    const each = Math.floor(cents / count);
    const start = parseISO(gen.first);
    setRows(
      Array.from({ length: count }, (_, n) => ({
        key: rowKey++,
        dueDate: format(gen.every === "month" ? addMonths(start, n) : addWeeks(start, n), "yyyy-MM-dd"),
        // The last instalment absorbs any rounding so the total matches the deal.
        amount: ((n === count - 1 ? cents - each * (count - 1) : each) / 100).toFixed(2),
      })),
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid items-end gap-3 sm:grid-cols-4">
        <FormField label="Split into">
          <Input type="number" min={1} max={60} value={gen.count} onChange={(e) => setGen((g) => ({ ...g, count: e.target.value }))} />
        </FormField>
        <FormField label="First due">
          <Input type="date" value={gen.first} onChange={(e) => setGen((g) => ({ ...g, first: e.target.value }))} />
        </FormField>
        <FormField label="Every">
          <Select value={gen.every} onValueChange={(e) => setGen((g) => ({ ...g, every: e as "month" | "week" }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <Button type="button" variant="outline" onClick={generate}>
          Fill equal instalments
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Instalments</Label>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No instalments. Saving now clears the schedule.</p>}
        {rows.map((r, n) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="w-6 text-xs text-muted-foreground">#{n + 1}</span>
            <Input type="date" aria-label={`Instalment ${n + 1} due date`} value={r.dueDate} onChange={(e) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, dueDate: e.target.value } : x)))} />
            <Input type="number" min={0} step="0.01" aria-label={`Instalment ${n + 1} amount`} value={r.amount} onChange={(e) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove instalment ${n + 1}`} onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((l) => [...l, { key: rowKey++, dueDate: today(), amount: "" }])}>
          Add instalment
        </Button>
        <p className={cn("text-xs", total > view.dealAmount ? "text-destructive" : "text-muted-foreground")}>
          Total {money(total, view.currency)} of {money(view.dealAmount, view.currency)}
        </p>
        {form.formError && <p role="alert" className="text-xs text-destructive">{form.err("instalments") ?? form.formError}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={save.isPending}
          onClick={async () => {
            const ok = await form.run(() =>
              save.mutateAsync(rows.map((r) => ({ dueDate: r.dueDate, amount: r.amount.trim() === "" ? NaN : Number(r.amount) }))),
            );
            if (ok) {
              toast.success("Schedule saved");
              onDone();
            }
          }}
        >
          {save.isPending ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
