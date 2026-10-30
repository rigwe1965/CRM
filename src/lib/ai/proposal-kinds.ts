import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { assertLinks, ownerScope, resolveOwner, taskScope, tenantScope } from "@/lib/access";
import { changeDealStage, createContact, createDeal, createTask, logActivity, updateTask } from "@/lib/crm-actions";
import { recordPayment } from "@/lib/record-payment";
import { replaceSchedule, scheduleKey } from "@/lib/replace-schedule";
import { assertWithinPlan } from "@/lib/plan-limits";
import { findDuplicates } from "@/lib/duplicates";
import { itemsTotal } from "@/lib/deals";
import { dealPaymentsView, summarize } from "@/lib/payments";
import { createActivitySchema, createContactSchema, createDealSchema, createPaymentSchema, createTaskSchema, dealStageSchema, scheduleSchema, updateTaskSchema } from "@/lib/validations/crm";
import { ToolError } from "@/lib/ai/tools/types";
import { fullName } from "@/lib/ai/tools/result";

/**
 * What Ivy can propose (AI_ASSISTANT_PLAN.md, Phase 2). For each kind: `input` is what the model may send, `prepare`
 * checks it against the same schemas and scope the screens use and builds the card text from the checked values
 * (never from the model's own wording), and `apply` runs the real action as the signed-in person when they approve.
 * Nothing here runs without a person's approval except `prepare`, which only reads.
 */

export type PreviewLine = { label: string; value: string };
/** What the card shows. Built by the server from the saved values. `draft` is a message to copy, never sent by us. */
export type Preview = {
  title: string;
  lines: PreviewLine[];
  warning?: string;
  draft?: { text: string };
  /** Money actions: the words on the button and in the confirmation dialog, with the exact amount, built by the server. */
  confirm?: { title?: string; button: string; message: string };
};
export type Prepared = { params: Record<string, unknown>; preview: Preview };
export type Applied = { entity: string; id: string; href: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-05");
const id = z.string().trim().min(1).max(40);
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const taskStatus = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]);
const stage = z.enum(["QUALIFICATION", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"]);

export const nice = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const line = (label: string, value: string | null | undefined): PreviewLine[] => (value ? [{ label, value }] : []);

/** Problems with what the model sent go back to it in words, so it can correct itself or ask the person. */
function parseOrTell<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ToolError(r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return r.data;
}

async function visible<T>(check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch (e) {
    // "You can only assign records to yourself", "Contact not found": the model may correct itself, the person is unaffected.
    if (e instanceof ApiError) throw new ToolError(e.message);
    throw e;
  }
}

const contactName = async (user: SessionUser, contactId: string | null | undefined) => {
  if (!contactId) return null;
  const c = await db.contact.findFirst({ where: { id: contactId, deletedAt: null, ...ownerScope(user) }, select: { firstName: true, lastName: true } });
  return fullName(c);
};
const dealTitle = async (user: SessionUser, dealId: string | null | undefined) => {
  if (!dealId) return null;
  return (await db.deal.findFirst({ where: { id: dealId, deletedAt: null, ...ownerScope(user) }, select: { title: true } }))?.title ?? null;
};

// ─── Create a task ──────────────────────────────────────

export const taskCreateInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  dueDate: date.optional().describe("YYYY-MM-DD"),
  priority: priority.optional(),
  contactId: id.optional().describe("From find_contacts."),
  dealId: id.optional().describe("From find_deals."),
  assigneeId: id.optional().describe("Only admins can give a task to someone else; leave out to assign it to the person asking."),
});

const taskCreate = {
  edit: z.object({ title: z.string().trim().min(1).max(200), dueDate: date.nullable(), priority }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof taskCreateInput>): Promise<Prepared> {
    const body = parseOrTell(createTaskSchema, { ...raw, status: "TODO" });
    await visible(() => assertLinks(user, body));
    const assigneeId = raw.assigneeId ? await visible(() => resolveOwner(user, raw.assigneeId)) : null;
    const assignee = assigneeId ? await db.user.findFirst({ where: { id: assigneeId, ...tenantScope(user) }, select: { name: true } }) : null;
    const params = { title: body.title, description: body.description ?? null, priority: body.priority, dueDate: raw.dueDate ?? null, contactId: body.contactId ?? null, dealId: body.dealId ?? null, assigneeId };
    return {
      params,
      preview: {
        title: "Create a task",
        lines: [
          ...line("Task", body.title), ...line("Due", raw.dueDate), ...line("Priority", nice(body.priority)), ...line("About", await contactName(user, body.contactId)),
          ...line("Deal", await dealTitle(user, body.dealId)), ...line("Assigned to", assignee?.name ?? (assigneeId && assigneeId !== user.id ? "Another team member" : "You")), ...line("Notes", body.description),
        ],
      },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const body = parseOrTell(createTaskSchema, { ...p, status: "TODO", assigneeId: p.assigneeId ?? undefined });
    const task = await createTask(user, body);
    return { entity: "task", id: task.id, href: "/tasks" };
  },
};

// ─── Change a task ──────────────────────────────────────

export const taskChangeInput = z.object({
  taskId: id.describe("From list_tasks."),
  status: taskStatus.optional(),
  dueDate: date.optional().describe("YYYY-MM-DD"),
  priority: priority.optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

const taskChange = {
  edit: z.object({ title: z.string().trim().min(1).max(200), dueDate: date, priority, status: taskStatus }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof taskChangeInput>): Promise<Prepared> {
    const { taskId, ...changes } = raw;
    if (Object.values(changes).every((v) => v === undefined)) throw new ToolError("Say what should change: status, dueDate, priority or title.");
    parseOrTell(updateTaskSchema, changes);
    const t = await db.task.findFirst({ where: { AND: [{ id: taskId }, taskScope(user)] }, select: { title: true, status: true, priority: true, dueDate: true } });
    if (!t) throw new ToolError("No task with that id is visible to you. Use list_tasks to find it.");
    const was = { status: t.status, priority: t.priority, dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null, title: t.title };
    const diff = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined && changes[k] !== was[k]);
    if (diff.length === 0) throw new ToolError("The task already looks like that, so there is nothing to change.");
    const lines: PreviewLine[] = [{ label: "Task", value: t.title }];
    if (changes.status && changes.status !== was.status) lines.push({ label: "Status", value: `${nice(was.status)} → ${nice(changes.status)}` });
    if (changes.dueDate && changes.dueDate !== was.dueDate) lines.push({ label: "Due", value: `${was.dueDate ?? "no date"} → ${changes.dueDate}` });
    if (changes.priority && changes.priority !== was.priority) lines.push({ label: "Priority", value: `${nice(was.priority)} → ${nice(changes.priority)}` });
    if (changes.title && changes.title !== was.title) lines.push({ label: "New title", value: changes.title });
    return { params: { taskId, changes: Object.fromEntries(diff.map((k) => [k, changes[k]])), expect: { status: was.status } }, preview: { title: "Change a task", lines } };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { taskId, changes, expect } = p as { taskId: string; changes: Record<string, unknown>; expect: { status: string } };
    const body = parseOrTell(updateTaskSchema, changes);
    const now = await db.task.findFirst({ where: { AND: [{ id: taskId }, taskScope(user)] }, select: { status: true } });
    if (!now) throw new ApiError(404, "That task no longer exists, so nothing was changed.", "NOT_FOUND");
    if (now.status !== expect.status) throw new ApiError(409, `The task is now ${nice(now.status)} (it was ${nice(expect.status)} when Ivy suggested this), so nothing was changed.`, "AI_PROPOSAL_STALE");
    const task = await updateTask(user, taskId, body);
    return { entity: "task", id: task.id, href: "/tasks" };
  },
};

// ─── Log a note ─────────────────────────────────────────

export const noteCreateInput = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000).optional(),
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING"]).optional().describe("Defaults to NOTE. This only records it; nothing is sent."),
  contactId: id.optional().describe("From find_contacts."),
  dealId: id.optional().describe("From find_deals."),
});

const noteCreate = {
  edit: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().max(2000) }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof noteCreateInput>): Promise<Prepared> {
    if (!raw.contactId && !raw.dealId) throw new ToolError("Which contact or deal is this note about? Ask the person, or look it up first.");
    const body = parseOrTell(createActivitySchema, raw);
    await visible(() => assertLinks(user, body));
    const [who, deal] = await Promise.all([contactName(user, body.contactId), dealTitle(user, body.dealId)]);
    return {
      params: { type: body.type, subject: body.subject, body: body.body ?? null, contactId: body.contactId ?? null, dealId: body.dealId ?? null },
      preview: { title: `Log a ${body.type.toLowerCase()}`, lines: [...line("Subject", body.subject), ...line("Details", body.body), ...line("About", who), ...line("Deal", deal)] },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const body = parseOrTell(createActivitySchema, p);
    const a = await logActivity(user, body);
    return { entity: "activity", id: a.id, href: body.contactId ? `/contacts/${body.contactId}` : `/deals/${body.dealId}` };
  },
};

// ─── Change a deal's stage ──────────────────────────────

export const stageChangeInput = z.object({
  dealId: id.describe("From find_deals."),
  stage,
  lostReason: z.string().trim().max(500).optional().describe("Only for CLOSED_LOST."),
});

const stageChange = {
  edit: z.object({ stage, lostReason: z.string().trim().max(500) }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof stageChangeInput>): Promise<Prepared> {
    const body = parseOrTell(dealStageSchema, { stage: raw.stage, lostReason: raw.lostReason });
    const d = await db.deal.findFirst({ where: { id: raw.dealId, deletedAt: null, ...ownerScope(user) }, select: { title: true, stage: true, currency: true, contact: { select: { firstName: true, lastName: true } } } });
    if (!d) throw new ToolError("No deal with that id is visible to you. Use find_deals to find it.");
    if (d.stage === body.stage) throw new ToolError(`The deal is already in ${nice(d.stage)}.`);
    const closing = body.stage === "CLOSED_WON" || body.stage === "CLOSED_LOST";
    const reopening = (d.stage === "CLOSED_WON" || d.stage === "CLOSED_LOST") && !closing;
    const warning = closing
      ? `This closes the deal as ${body.stage === "CLOSED_WON" ? "won (100%)" : "lost (0%)"}. Stage notifications and automations run, the same as moving it on the Deals page.`
      : reopening ? "This reopens a closed deal and clears its close date." : undefined;
    return {
      params: { dealId: raw.dealId, stage: body.stage, lostReason: body.lostReason ?? null, fromStage: d.stage },
      preview: { title: "Move a deal to another stage", lines: [...line("Deal", d.title), ...line("Customer", fullName(d.contact)), { label: "Stage", value: `${nice(d.stage)} → ${nice(body.stage)}` }, ...line("Reason", body.lostReason)], warning },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { dealId, fromStage, ...rest } = p as { dealId: string; fromStage: string; stage: string; lostReason: string | null };
    const body = parseOrTell(dealStageSchema, { stage: rest.stage, lostReason: rest.lostReason ?? undefined });
    const now = await db.deal.findFirst({ where: { id: dealId, deletedAt: null, ...ownerScope(user) }, select: { stage: true } });
    if (!now) throw new ApiError(404, "That deal no longer exists, so nothing was changed.", "NOT_FOUND");
    if (now.stage !== fromStage) throw new ApiError(409, `The deal is now in ${nice(now.stage)} (it was in ${nice(fromStage)} when Ivy suggested this), so nothing was changed.`, "AI_PROPOSAL_STALE");
    await changeDealStage(user, dealId, body);
    return { entity: "deal", id: dealId, href: `/deals/${dealId}` };
  },
};

// ─── Draft a message (never sent) ───────────────────────

export const messageDraftInput = z.object({
  contactId: id.describe("From find_contacts."),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  subject: z.string().trim().max(200).optional().describe("Email only."),
  message: z.string().trim().min(1).max(4000),
});

const messageDraft = {
  edit: z.object({}),
  async prepare(user: SessionUser, raw: z.infer<typeof messageDraftInput>): Promise<Prepared> {
    const c = await db.contact.findFirst({
      where: { id: raw.contactId, deletedAt: null, ...ownerScope(user) },
      select: { firstName: true, lastName: true, emailOptOut: true, whatsappOptIn: true },
    });
    if (!c) throw new ToolError("No contact with that id is visible to you. Use find_contacts to find them.");
    const warning = raw.channel === "EMAIL" && c.emailOptOut ? "This contact has opted out of email." : raw.channel === "WHATSAPP" && !c.whatsappOptIn ? "This contact has not opted in to WhatsApp." : undefined;
    const text = raw.message;
    return {
      params: { contactId: raw.contactId, channel: raw.channel, subject: raw.subject ?? null, message: text },
      preview: {
        title: `Draft ${raw.channel === "EMAIL" ? "email" : "WhatsApp message"}`,
        lines: [...line("To", fullName(c)), ...(raw.channel === "EMAIL" ? line("Subject", raw.subject) : [])],
        warning,
        draft: { text },
      },
    };
  },
};

// ─── Record a payment (the strictest card) ──────────────

const money = (n: number) => n.toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

export const paymentInput = z.object({
  dealId: id.describe("From find_deals."),
  amount: z.number().positive().max(100_000_000).describe("Exactly the amount the person said they received, in the deal's own currency. Never a figure you worked out."),
  currency: z.string().trim().length(3).optional().describe("Only if the person named a currency. It is checked against the deal's and the proposal is refused if they differ; it does not choose the currency."),
  paidAt: date.optional().describe("YYYY-MM-DD, the day the money arrived. Defaults to today."),
  method: z.enum(["BANK_TRANSFER", "CASH", "DIGITAL", "OTHER"]).optional(),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional(),
});

const paymentRecord = {
  edit: z.object({ paidAt: date, method: z.enum(["BANK_TRANSFER", "CASH", "DIGITAL", "OTHER"]), reference: z.string().trim().max(100), note: z.string().trim().max(500) }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof paymentInput>): Promise<Prepared> {
    const paidAt = raw.paidAt ?? today();
    if (paidAt > today()) throw new ToolError("That date is in the future. A payment can only be recorded for money already received.");
    const body = parseOrTell(createPaymentSchema, { amount: raw.amount, paidAt, method: raw.method, reference: raw.reference, note: raw.note });
    const deal = await db.deal.findFirst({
      where: { id: raw.dealId, deletedAt: null, ...ownerScope(user) },
      select: { id: true, title: true, amount: true, currency: true, contact: { select: { firstName: true, lastName: true } } },
    });
    if (!deal) throw new ToolError("No deal with that id is visible to you. Use find_deals to find it.");
    if (raw.currency && raw.currency.toUpperCase() !== deal.currency) {
      throw new ToolError(`That deal is in ${deal.currency}, not ${raw.currency.toUpperCase()}. Payments are recorded in the deal's own currency, so tell the person and propose nothing.`);
    }
    const view = await dealPaymentsView(deal);
    const { paid, balance } = view.summary;
    if (body.amount > balance) throw new ToolError(`That is more than the balance of ${money(balance)} ${deal.currency} still owed on this deal, so it cannot be recorded. Tell the person.`);

    const schedule = view.instalments.map((i) => ({ id: i.id, position: i.position, dueDate: i.dueDate, amount: i.amount }));
    const after = summarize(view.dealAmount, paid + body.amount, schedule).instalments;
    const clears = after
      .map((a) => ({ a, before: view.instalments.find((b) => b.id === a.id)!.covered }))
      .filter(({ a, before }) => a.covered > before)
      .map(({ a }) => `No. ${a.position} due ${a.dueDate.toISOString().slice(0, 10)}: ${money(a.covered)} of ${money(a.amount)} covered`);

    const since = new Date(Date.now() - 7 * 86_400_000);
    const [same, openLink] = await Promise.all([
      db.payment.findFirst({ where: { dealId: deal.id, tenantId: user.tenantId, amount: body.amount, paidAt: { gte: since } }, select: { paidAt: true } }),
      db.paymentLink.findFirst({ where: { dealId: deal.id, tenantId: user.tenantId, status: "PENDING" }, select: { id: true } }),
    ]);
    const warnings = [
      same && `A payment of exactly ${money(body.amount)} ${deal.currency} was already recorded on this deal on ${same.paidAt.toISOString().slice(0, 10)}. Make sure this is not the same money entered twice.`,
      openLink && "This deal has an open online payment link. If the customer also pays through it, the money would be counted twice.",
    ].filter(Boolean);

    const who = fullName(deal.contact);
    const amountText = `${money(body.amount)} ${deal.currency}`;
    return {
      params: { dealId: deal.id, amount: body.amount, paidAt, method: body.method, reference: body.reference ?? null, note: body.note ?? null, expect: { paid } },
      preview: {
        title: "Record a payment",
        lines: [
          ...line("Customer", who), ...line("Deal", deal.title), { label: "Amount", value: amountText }, { label: "Balance", value: `${money(balance)} → ${money(balance - body.amount)} ${deal.currency}` },
          { label: "Date paid", value: paidAt }, { label: "Method", value: nice(body.method) }, ...line("Reference", body.reference), ...line("Notes", body.note), ...(clears.length ? [{ label: "Clears", value: clears.join("; ") }] : []),
        ],
        warning: warnings.length ? warnings.join(" ") : undefined,
        confirm: { title: "Record this payment?", button: `Record ${amountText}`, message: `Record ${amountText}${who ? ` from ${who}` : ""} on "${deal.title}"? This changes what the customer owes, and takes ${money(balance)} ${deal.currency} down to ${money(balance - body.amount)} ${deal.currency}.` },
      },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { dealId, expect } = p as { dealId: string; expect: { paid: number } };
    if (String(p.paidAt) > today()) throw new ApiError(422, "That date is in the future, so nothing was recorded.", "VALIDATION_ERROR");
    const body = parseOrTell(createPaymentSchema, { amount: p.amount, paidAt: p.paidAt, method: p.method, reference: p.reference ?? undefined, note: p.note ?? undefined });
    await recordPayment(user, dealId, body, { expectPaid: expect.paid });
    return { entity: "deal", id: dealId, href: `/deals/${dealId}` };
  },
};

// ─── Create a contact ───────────────────────────────────

export const contactCreateInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional().describe("With the country code if you know it, e.g. +2348012345678."),
  type: z.enum(["LEAD", "PROSPECT", "CUSTOMER", "PARTNER", "OTHER"]).optional().describe("Defaults to LEAD."),
  title: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  source: z.string().trim().max(100).optional().describe("Where they came from, only if the person said."),
});

const contactCreate = {
  edit: z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), email: z.string().trim().max(200), phone: z.string().trim().max(40), city: z.string().trim().max(100), country: z.string().trim().max(100) }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof contactCreateInput>): Promise<Prepared> {
    const body = parseOrTell(createContactSchema, raw);
    await visible(() => assertWithinPlan(user.tenantId, "contacts"));
    const matches = await findDuplicates(ownerScope(user), { firstName: body.firstName, lastName: body.lastName, phone: body.phone ?? undefined, email: body.email ?? undefined });
    const sameEmail = matches.find((m) => m.reasons.includes("Same email"));
    if (sameEmail) throw new ToolError(`A contact with that email already exists: ${fullName(sameEmail)}. Do not create another; use get_contact to look at them.`);
    const warning = matches.length ? `Possible duplicate: ${matches.slice(0, 3).map((m) => `${fullName(m)} (${m.reasons.join(", ").toLowerCase()})`).join("; ")}. Check before approving.` : undefined;
    const params = { firstName: body.firstName, lastName: body.lastName, email: body.email ?? null, phone: body.phone ?? null, type: body.type, title: body.title ?? null, city: body.city ?? null, country: body.country ?? null, source: body.source ?? null };
    return {
      params,
      preview: { title: "Create a contact", lines: [{ label: "Name", value: `${body.firstName} ${body.lastName}` }, ...line("Email", body.email), ...line("Phone", body.phone), { label: "Type", value: nice(body.type) }, ...line("City", body.city), ...line("Country", body.country), ...line("Source", body.source), { label: "Owner", value: "You" }], warning },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const body = parseOrTell(createContactSchema, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== "")));
    try {
      const c = await createContact(user, body);
      return { entity: "contact", id: c.id, href: `/contacts/${c.id}` };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, "A contact with that email already exists, so nothing was created.", "AI_PROPOSAL_STALE");
      throw e;
    }
  },
};

// ─── Create a deal with its items ───────────────────────

const dealItemInput = z.object({
  productType: z.string().trim().min(1).max(100).describe("For example Body wave, Straight, Closure, Frontal."),
  texture: z.string().trim().max(100).optional(),
  lengthInches: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  laceType: z.string().trim().max(100).optional(),
  quantity: z.number().int().min(1).max(100_000),
  unitPrice: z.number().min(0).max(10_000_000).describe("Per unit, as the person said. Never guess a price: ask."),
});

export const dealCreateInput = z.object({
  contactId: id.describe("The customer, from find_contacts."),
  title: z.string().trim().min(1).max(200),
  currency: z.string().trim().length(3).describe("The deal's currency, e.g. USD. One currency per deal. Ask if the person did not say."),
  items: z.array(dealItemInput).min(1).max(20),
  expectedCloseDate: date.optional().describe("YYYY-MM-DD"),
});

const dealCreate = {
  edit: z.object({ title: z.string().trim().min(1).max(200), expectedCloseDate: date }).partial(),
  async prepare(user: SessionUser, input: z.infer<typeof dealCreateInput>): Promise<Prepared> {
    // The tool already validated this; checking again keeps `prepare` safe to call from anywhere (items, quantities and prices are required).
    const raw = parseOrTell(dealCreateInput, input);
    const body = parseOrTell(createDealSchema, { title: raw.title, currency: raw.currency, contactId: raw.contactId, expectedCloseDate: raw.expectedCloseDate, items: raw.items });
    await visible(() => assertLinks(user, { contactId: raw.contactId }));
    const who = await contactName(user, raw.contactId);
    const total = itemsTotal(raw.items);
    const dup = await db.deal.findFirst({
      where: { tenantId: user.tenantId, contactId: raw.contactId, deletedAt: null, title: { equals: body.title, mode: "insensitive" }, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      select: { id: true },
    });
    const describeItem = (i: z.infer<typeof dealItemInput>, n: number): PreviewLine => ({
      label: `Item ${n + 1}`,
      value: `${i.quantity} × ${[i.productType, i.texture, i.lengthInches && `${i.lengthInches}"`, i.color, i.laceType].filter(Boolean).join(" ")} at ${money(i.unitPrice)} = ${money(Math.round(i.quantity * i.unitPrice * 100) / 100)}`,
    });
    return {
      params: { contactId: raw.contactId, title: body.title, currency: body.currency, expectedCloseDate: raw.expectedCloseDate ?? null, items: raw.items },
      preview: {
        title: "Create a deal",
        lines: [...line("Customer", who), { label: "Deal", value: body.title }, ...raw.items.map(describeItem), { label: "Total", value: `${money(total)} ${body.currency}` }, { label: "Stage", value: "Qualification" }, ...line("Expected close", raw.expectedCloseDate)],
        warning: dup ? "A deal with this title was already created for this customer in the last 24 hours. Make sure this is not a duplicate." : undefined,
      },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const body = parseOrTell(createDealSchema, { ...p, expectedCloseDate: p.expectedCloseDate ?? undefined });
    const d = await createDeal(user, body);
    return { entity: "deal", id: d.id, href: `/deals/${d.id}` };
  },
};

// ─── Replace a deal's instalment schedule (Phase 3a) ────

/** The date `k` months after `d`, in UTC, landing on the last day of a shorter month rather than spilling into the next. */
export function addMonthsUtc(d: Date, k: number): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return out;
}

/** Splits `total` into `count` equal instalments, any odd cents on the last, spaced from `first` by the chosen step. Worked out here, never by the model. */
export function evenSchedule(total: number, count: number, first: Date, every: "WEEK" | "TWO_WEEKS" | "MONTH") {
  const base = Math.floor((total * 100) / count) / 100;
  const last = Math.round((total - base * (count - 1)) * 100) / 100;
  return Array.from({ length: count }, (_, k) => ({
    dueDate: every === "MONTH" ? addMonthsUtc(first, k) : new Date(first.getTime() + k * (every === "WEEK" ? 7 : 14) * 86_400_000),
    amount: k === count - 1 ? last : base,
  }));
}

export const scheduleInput = z.object({
  dealId: id.describe("From find_deals."),
  even: z
    .object({
      count: z.number().int().min(2).max(24),
      firstDueDate: date.describe("YYYY-MM-DD"),
      every: z.enum(["WEEK", "TWO_WEEKS", "MONTH"]),
    })
    .optional()
    .describe("Use for 'N equal instalments': the CRM splits the deal total and spaces the dates. Give this OR custom, not both."),
  custom: z
    .array(z.object({ dueDate: date, amount: z.number().positive().max(100_000_000) }))
    .min(1)
    .max(24)
    .optional()
    .describe("Use only when the person gave each date and exact amount. Give this OR even, not both."),
});

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

const scheduleReplace = {
  edit: z.object({}),
  async prepare(user: SessionUser, input: z.infer<typeof scheduleInput>): Promise<Prepared> {
    const raw = parseOrTell(scheduleInput, input);
    if (!!raw.even === !!raw.custom) throw new ToolError("Give either `even` (equal instalments) or `custom` (each date and amount), not both and not neither.");
    const deal = await db.deal.findFirst({
      where: { id: raw.dealId, deletedAt: null, ...ownerScope(user) },
      select: { id: true, title: true, amount: true, currency: true, contact: { select: { firstName: true, lastName: true } } },
    });
    if (!deal) throw new ToolError("No deal with that id is visible to you. Use find_deals to find it.");
    const dealAmount = Number(deal.amount);
    if (dealAmount <= 0) throw new ToolError("This deal has no amount yet, so there is nothing to split into instalments.");

    const rows = (raw.even ? evenSchedule(dealAmount, raw.even.count, new Date(raw.even.firstDueDate), raw.even.every) : raw.custom!.map((c) => ({ dueDate: new Date(c.dueDate), amount: c.amount })))
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    parseOrTell(scheduleSchema, { instalments: rows.map((r) => ({ dueDate: dayStr(r.dueDate), amount: r.amount })) });
    const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (total > dealAmount) throw new ToolError(`Those instalments add up to ${money(total)}, more than the deal amount of ${money(dealAmount)} ${deal.currency}. Tell the person.`);

    const view = await dealPaymentsView(deal);
    const { paid } = view.summary;
    const shown = summarize(dealAmount, paid, rows.map((r, i) => ({ id: `n${i}`, position: i + 1, dueDate: r.dueDate, amount: r.amount }))).instalments;
    const lines: PreviewLine[] = shown.map((s) => ({
      label: `No. ${s.position}`,
      value: `due ${dayStr(s.dueDate)}: ${money(s.amount)} ${deal.currency} (${s.covered >= s.amount ? "already covered by payments" : s.covered > 0 ? `part covered: ${money(s.covered)} paid` : "open"})`,
    }));
    const existing = view.instalments;
    const today = dayStr(new Date());
    const warnings = [
      existing.length > 0 && `This replaces the current schedule of ${existing.length} instalment${existing.length === 1 ? "" : "s"} (${existing.map((e) => money(e.amount)).join(", ")}). Replacing it also clears the reminder history, so customers may be sent reminders again for the new dates.`,
      total < dealAmount && `The instalments cover ${money(total)} of the ${money(dealAmount)} ${deal.currency} deal; ${money(dealAmount - total)} is not scheduled.`,
      rows.some((r) => dayStr(r.dueDate) < today) && "Some due dates are in the past, so they count as overdue straight away.",
    ].filter(Boolean);
    const who = fullName(deal.contact);
    const verb = existing.length ? "Replace schedule" : "Set schedule";
    return {
      params: { dealId: deal.id, instalments: rows.map((r) => ({ dueDate: dayStr(r.dueDate), amount: r.amount })), expect: { paid, scheduleKey: scheduleKey(existing) } },
      preview: {
        title: existing.length ? "Replace the instalment schedule" : "Set an instalment schedule",
        lines: [...line("Customer", who), ...line("Deal", deal.title), { label: "Deal total", value: `${money(dealAmount)} ${deal.currency}` }, ...(paid > 0 ? [{ label: "Paid so far", value: `${money(paid)} ${deal.currency}` }] : []), ...lines, { label: "Scheduled", value: `${money(total)} ${deal.currency} in ${rows.length} instalments` }],
        warning: warnings.length ? warnings.join(" ") : undefined,
        confirm: {
          title: existing.length ? "Replace this schedule?" : "Set this schedule?",
          button: verb,
          message: `${verb} on "${deal.title}"${who ? ` for ${who}` : ""}: ${rows.length} instalments totalling ${money(total)} ${deal.currency}. Customers are sent reminders based on these dates.`,
        },
      },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { dealId, expect } = p as { dealId: string; expect: { paid: number; scheduleKey: string } };
    const body = parseOrTell(scheduleSchema, { instalments: p.instalments });
    await replaceSchedule(user, dealId, body.instalments, { expect });
    return { entity: "deal", id: dealId, href: `/deals/${dealId}` };
  },
};

// ─── Mark a customer as opted out of WhatsApp (Phase 3c) ─

export const optOutInput = z.object({ contactId: id });

/** Made by the WhatsApp triage when a customer's message asks us to stop, never by the model. Consent changes only when a person approves. */
const contactOptOut = {
  edit: z.object({}),
  async prepare(user: SessionUser, raw: z.infer<typeof optOutInput>): Promise<Prepared> {
    const c = await db.contact.findFirst({ where: { id: raw.contactId, deletedAt: null, ...ownerScope(user) }, select: { firstName: true, lastName: true, whatsappOptIn: true } });
    if (!c) throw new ToolError("No contact with that id is visible to you.");
    if (!c.whatsappOptIn) throw new ToolError("This contact is already marked as not agreeing to WhatsApp messages.");
    return {
      params: { contactId: raw.contactId },
      preview: {
        title: "Customer asked to stop WhatsApp messages",
        lines: [...line("Customer", fullName(c)), { label: "Change", value: "Mark as not agreeing to WhatsApp messages" }],
        warning: "Reminders and campaigns will no longer be sent to them on WhatsApp. You can tick it again on their contact if they change their mind.",
      },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { contactId } = parseOrTell(optOutInput, p);
    const { count } = await db.contact.updateMany({ where: { id: contactId, deletedAt: null, ...ownerScope(user) }, data: { whatsappOptIn: false } });
    if (count === 0) throw new ApiError(404, "That contact no longer exists, so nothing was changed.", "NOT_FOUND");
    return { entity: "contact", id: contactId, href: `/contacts/${contactId}` };
  },
};

export type KindDef = {
  /** What a person may change on the card before approving; checked again on approval. */
  edit: z.ZodType<Record<string, unknown>>;
  prepare: (user: SessionUser, raw: never) => Promise<Prepared>;
  /** Absent for drafts: nothing is done, the person copies the text. */
  apply?: (user: SessionUser, params: Record<string, unknown>) => Promise<Applied>;
};

export const KINDS = {
  TASK_CREATE: taskCreate,
  TASK_CHANGE: taskChange,
  NOTE_CREATE: noteCreate,
  STAGE_CHANGE: stageChange,
  MESSAGE_DRAFT: messageDraft,
  PAYMENT_RECORD: paymentRecord,
  CONTACT_CREATE: contactCreate,
  DEAL_CREATE: dealCreate,
  SCHEDULE_REPLACE: scheduleReplace,
  CONTACT_OPT_OUT: contactOptOut,
} as unknown as Record<"TASK_CREATE" | "TASK_CHANGE" | "NOTE_CREATE" | "STAGE_CHANGE" | "MESSAGE_DRAFT" | "PAYMENT_RECORD" | "CONTACT_CREATE" | "DEAL_CREATE" | "SCHEDULE_REPLACE" | "CONTACT_OPT_OUT", KindDef>;
