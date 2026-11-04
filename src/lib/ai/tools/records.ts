import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorScope, taskScope } from "@/lib/access";
import { paymentSummaries, summarize } from "@/lib/payments";
import { reconcileDeal } from "@/lib/reconcile";
import { clip, fullName, isoDate } from "@/lib/ai/tools/result";
import { defineTool, ToolError } from "@/lib/ai/tools/types";

/**
 * Tools over the people and paperwork: contacts, deals, tasks and supplier invoices. Each one reads through the
 * caller's own scope (`owned`, or the task and activity scopes), so AI sees exactly what the person asking can see.
 */

const CONTACT_TYPES = ["LEAD", "PROSPECT", "CUSTOMER", "PARTNER", "OTHER"] as const;
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"] as const;
const STAGES = ["QUALIFICATION", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"] as const;
const INVOICE_STATUSES = ["DRAFT", "SENT", "PAID", "CANCELLED"] as const;

const ci = { mode: "insensitive" as const };
/** "ada okafor" → two words that must each match somewhere, so a full name finds the person. */
const words = (q: string | undefined) => (q ?? "").split(/\s+/).filter(Boolean).slice(0, 4);
const id = z.string().trim().min(1).max(40).describe("The record's id, from an earlier search.");

export const findContacts = defineTool({
  name: "find_contacts",
  description:
    "Search the contacts you can see by part of a name, email address, phone number or company. Several words must each match. Optionally filter by type or lead status. Returns the matches (up to `limit`) and the total count.",
  schema: z.object({
    query: z.string().trim().max(80).optional().describe("Part of a name, email, phone number or company. Leave out to list contacts."),
    type: z.enum(CONTACT_TYPES).optional(),
    leadStatus: z.enum(LEAD_STATUSES).optional(),
    limit: z.number().int().min(1).max(15).default(10),
  }),
  label: (i) => (i.query ? `Searching contacts for “${i.query}”` : "Looking through contacts"),
  fallbackLabel: "Searching contacts",
  run: async ({ owned }, i) => {
    const where: Prisma.ContactWhereInput = {
      AND: [
        { deletedAt: null },
        owned,
        { ...(i.type && { type: i.type }), ...(i.leadStatus && { leadStatus: i.leadStatus }) },
        ...words(i.query).map((w) => ({
          OR: [{ firstName: { contains: w, ...ci } }, { lastName: { contains: w, ...ci } }, { email: { contains: w, ...ci } }, { phone: { contains: w } }, { organization: { name: { contains: w, ...ci } } }],
        })),
      ],
    };
    const [total, rows] = await Promise.all([
      db.contact.count({ where }),
      db.contact.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        take: i.limit,
        select: {
          id: true, firstName: true, lastName: true, type: true, leadStatus: true, email: true, phone: true, city: true, country: true, source: true, createdAt: true,
          organization: { select: { name: true } }, owner: { select: { name: true } }, _count: { select: { deals: { where: { deletedAt: null } } } },
        },
      }),
    ]);
    return {
      total,
      rows: rows.map((c) => ({
        id: c.id, name: fullName(c), type: c.type, leadStatus: c.leadStatus, company: c.organization?.name ?? null, email: c.email, phone: c.phone,
        city: c.city, country: c.country, source: c.source, owner: c.owner?.name ?? null, deals: c._count.deals, added: isoDate(c.createdAt),
      })),
    };
  },
});

export const getContact = defineTool({
  name: "get_contact",
  description: "Everything about one contact: details, their deals with what is owed, their latest activity and their open tasks. Needs the contact's id from find_contacts.",
  schema: z.object({ id }),
  label: () => "Opening a contact",
  fallbackLabel: "Opening a contact",
  run: async ({ user, owned }, i) => {
    const c = await db.contact.findFirst({
      where: { id: i.id, deletedAt: null, ...owned },
      select: {
        id: true, firstName: true, lastName: true, title: true, type: true, leadStatus: true, source: true, email: true, phone: true, city: true, country: true,
        emailOptOut: true, whatsappOptIn: true, createdAt: true,
        organization: { select: { name: true } }, owner: { select: { name: true } }, tags: { select: { tag: { select: { name: true } } } },
      },
    });
    if (!c) throw new ToolError("No contact with that id is visible to you. Use find_contacts to look for them.");
    const [deals, activities, tasks] = await Promise.all([
      db.deal.findMany({
        where: { contactId: c.id, deletedAt: null, ...owned },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, stage: true, amount: true, currency: true },
      }),
      db.activity.findMany({
        where: { contactId: c.id, ...authorScope(user) },
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: { type: true, direction: true, subject: true, occurredAt: true },
      }),
      db.task.findMany({
        where: { AND: [taskScope(user), { contactId: c.id, status: { in: ["TODO", "IN_PROGRESS"] } }] },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: 5,
        select: { title: true, status: true, priority: true, dueDate: true },
      }),
    ]);
    const money = await paymentSummaries(deals);
    return {
      id: c.id, name: fullName(c), title: c.title, type: c.type, leadStatus: c.leadStatus, source: c.source, company: c.organization?.name ?? null, owner: c.owner?.name ?? null,
      email: c.email, phone: c.phone, city: c.city, country: c.country, tags: c.tags.map((t) => t.tag.name), emailOptOut: c.emailOptOut, whatsappOptIn: c.whatsappOptIn, added: isoDate(c.createdAt),
      deals: deals.map((d) => {
        const m = money.get(d.id);
        return { id: d.id, title: d.title, stage: d.stage, amount: Number(d.amount), currency: d.currency, paid: m?.paid ?? 0, balance: m?.balance ?? Number(d.amount), overdue: m?.overdue ?? false };
      }),
      recentActivity: activities.map((a) => ({ type: a.type, direction: a.direction, subject: clip(a.subject, 120), date: isoDate(a.occurredAt) })),
      openTasks: tasks.map((t) => ({ title: clip(t.title, 120), status: t.status, priority: t.priority, due: isoDate(t.dueDate) })),
    };
  },
});

export const findDeals = defineTool({
  name: "find_deals",
  description:
    "Search the deals (customer orders) you can see by part of a title, customer name or company. Filter by stage or contact. Each deal shows its amount and currency, what has been paid, the balance, and whether an instalment is overdue. Returns up to `limit` and the total.",
  schema: z.object({
    query: z.string().trim().max(80).optional().describe("Part of a deal title, customer name or company. Several words must each match."),
    stage: z.array(z.enum(STAGES)).max(6).optional().describe("Only deals in these stages."),
    contactId: id.optional(),
    limit: z.number().int().min(1).max(15).default(10),
  }),
  label: (i) => (i.query ? `Searching deals for “${i.query}”` : "Looking through deals"),
  fallbackLabel: "Searching deals",
  run: async ({ owned }, i) => {
    const where: Prisma.DealWhereInput = {
      AND: [
        { deletedAt: null },
        owned,
        { ...(i.stage?.length && { stage: { in: i.stage } }), ...(i.contactId && { contactId: i.contactId }) },
        ...words(i.query).map((w) => ({
          OR: [{ title: { contains: w, ...ci } }, { contact: { firstName: { contains: w, ...ci } } }, { contact: { lastName: { contains: w, ...ci } } }, { organization: { name: { contains: w, ...ci } } }],
        })),
      ],
    };
    const [total, rows] = await Promise.all([
      db.deal.count({ where }),
      db.deal.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: i.limit,
        select: {
          id: true, title: true, stage: true, amount: true, currency: true, expectedCloseDate: true, createdAt: true,
          contact: { select: { firstName: true, lastName: true } }, organization: { select: { name: true } }, owner: { select: { name: true } },
        },
      }),
    ]);
    const money = await paymentSummaries(rows);
    return {
      total,
      rows: rows.map((d) => {
        const m = money.get(d.id);
        return {
          id: d.id, title: d.title, stage: d.stage, amount: Number(d.amount), currency: d.currency, customer: fullName(d.contact), company: d.organization?.name ?? null, owner: d.owner?.name ?? null,
          paid: m?.paid ?? 0, balance: m?.balance ?? Number(d.amount), overdue: m?.overdue ?? false, nextDue: m?.nextDue ? { date: isoDate(m.nextDue.dueDate), amount: m.nextDue.amount } : null,
          expectedClose: isoDate(d.expectedCloseDate), created: isoDate(d.createdAt),
        };
      }),
    };
  },
});

export const getDeal = defineTool({
  name: "get_deal",
  description:
    "Everything about one deal: its items, every payment, the instalment schedule with what each instalment has covered, the balance, and any money problems found on it. Needs the deal's id from find_deals.",
  schema: z.object({ id }),
  label: () => "Opening a deal",
  fallbackLabel: "Opening a deal",
  run: async ({ owned, now }, i) => {
    const d = await db.deal.findFirst({
      where: { id: i.id, deletedAt: null, ...owned },
      select: {
        id: true, title: true, stage: true, amount: true, currency: true, expectedCloseDate: true, closedAt: true, createdAt: true,
        contact: { select: { id: true, firstName: true, lastName: true } }, organization: { select: { name: true } }, owner: { select: { name: true } },
        items: { orderBy: { position: "asc" }, select: { productType: true, texture: true, lengthInches: true, color: true, laceType: true, quantity: true, unitPrice: true } },
        payments: { orderBy: { paidAt: "desc" }, select: { amount: true, paidAt: true, method: true, source: true, providerRef: true } },
        instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
        paymentLinks: { select: { amount: true, currency: true, status: true, createdAt: true, payment: { select: { id: true } } } },
      },
    });
    if (!d) throw new ToolError("No deal with that id is visible to you. Use find_deals to look for it.");
    const amount = Number(d.amount);
    const paid = d.payments.reduce((s, p) => s + Number(p.amount), 0);
    const { summary, instalments } = summarize(amount, paid, d.instalments, now.toISOString().slice(0, 10));
    const findings = reconcileDeal(
      {
        id: d.id, title: d.title, amount, currency: d.currency, stage: d.stage,
        payments: d.payments.map((p) => ({ amount: Number(p.amount), source: p.source, providerRef: p.providerRef })),
        instalments: d.instalments.map((s) => ({ amount: Number(s.amount) })),
        items: d.items.map((x) => ({ quantity: x.quantity, unitPrice: Number(x.unitPrice) })),
        paymentLinks: d.paymentLinks.map((l) => ({ amount: Number(l.amount), currency: l.currency, status: l.status, createdAt: l.createdAt, hasPayment: !!l.payment })),
      },
      now,
    );
    return {
      id: d.id, title: d.title, stage: d.stage, amount, currency: d.currency, customer: fullName(d.contact), customerId: d.contact?.id ?? null, company: d.organization?.name ?? null, owner: d.owner?.name ?? null,
      created: isoDate(d.createdAt), expectedClose: isoDate(d.expectedCloseDate), closed: isoDate(d.closedAt),
      items: d.items.map((x) => ({ product: x.productType, texture: x.texture, length: x.lengthInches, color: x.color, lace: x.laceType, quantity: x.quantity, unitPrice: Number(x.unitPrice) })),
      paid: summary.paid, balance: summary.balance, overdue: summary.overdue, nextDue: summary.nextDue ? { date: isoDate(summary.nextDue.dueDate), amount: summary.nextDue.amount } : null,
      payments: d.payments.slice(0, 10).map((p) => ({ amount: Number(p.amount), date: isoDate(p.paidAt), method: p.method, online: p.source === "ONLINE" })),
      paymentCount: d.payments.length,
      instalments: instalments.map((x) => ({ number: x.position, due: isoDate(x.dueDate), amount: x.amount, covered: x.covered, overdue: x.overdue })),
      moneyProblems: findings.map((f) => ({ kind: f.kind, problem: f.detail, fix: f.fix })),
    };
  },
});

export const listTasks = defineTool({
  name: "list_tasks",
  description: "Tasks assigned to you or created by you (admins see all tasks): title, status, priority, due date and what they relate to. Filter by status or only overdue ones.",
  schema: z.object({
    status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
    overdue: z.boolean().optional().describe("Only open tasks past their due date."),
    limit: z.number().int().min(1).max(25).default(15),
  }),
  label: (i) => (i.overdue ? "Checking overdue tasks" : "Looking at tasks"),
  fallbackLabel: "Looking at tasks",
  run: async ({ user, now }, i) => {
    const where: Prisma.TaskWhereInput = {
      AND: [taskScope(user), { ...(i.status && { status: i.status }), ...(i.overdue && { dueDate: { lt: now }, status: { in: ["TODO", "IN_PROGRESS"] } }) }],
    };
    const [total, rows] = await Promise.all([
      db.task.count({ where }),
      db.task.findMany({
        where,
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: i.limit,
        select: {
          id: true, title: true, status: true, priority: true, dueDate: true, assignee: { select: { name: true } },
          contact: { select: { firstName: true, lastName: true } }, deal: { select: { title: true } },
        },
      }),
    ]);
    return {
      total,
      rows: rows.map((t) => ({ id: t.id, title: clip(t.title, 140), status: t.status, priority: t.priority, due: isoDate(t.dueDate), assignee: t.assignee.name, contact: fullName(t.contact), deal: t.deal?.title ?? null })),
    };
  },
});

export const findInvoices = defineTool({
  name: "find_invoices",
  description: "Supplier invoices (stock you bought): number, status, date, supplier, currency, total, and which customer deals they cover. Search by number, supplier or who it is billed to.",
  schema: z.object({
    query: z.string().trim().max(80).optional().describe("Part of an invoice number, supplier name or bill-to name."),
    status: z.enum(INVOICE_STATUSES).optional(),
    limit: z.number().int().min(1).max(15).default(10),
  }),
  label: (i) => (i.query ? `Searching invoices for “${i.query}”` : "Looking through invoices"),
  fallbackLabel: "Searching invoices",
  run: async ({ owned }, i) => {
    const where: Prisma.InvoiceWhereInput = {
      AND: [
        owned,
        { ...(i.status && { status: i.status }) },
        ...words(i.query).map((w) => ({ OR: [{ number: { contains: w, ...ci } }, { vendorName: { contains: w, ...ci } }, { billTo: { contains: w, ...ci } }] })),
      ],
    };
    const [total, rows] = await Promise.all([
      db.invoice.count({ where }),
      db.invoice.findMany({
        where,
        orderBy: [{ invoiceDate: "desc" }, { id: "asc" }],
        take: i.limit,
        select: { id: true, number: true, status: true, invoiceDate: true, vendorName: true, billTo: true, currency: true, subtotal: true, shipping: true, total: true, deals: { select: { title: true }, take: 3 } },
      }),
    ]);
    return {
      total,
      rows: rows.map((v) => ({
        id: v.id, number: v.number, status: v.status, date: isoDate(v.invoiceDate), supplier: v.vendorName, billTo: v.billTo, currency: v.currency,
        subtotal: Number(v.subtotal), shipping: Number(v.shipping), total: Number(v.total), deals: v.deals.map((x) => x.title),
      })),
    };
  },
});
