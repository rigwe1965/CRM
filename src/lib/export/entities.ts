import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { readQuery } from "@/lib/api";
import { authorScope, liveFilter, ownerScope, taskScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { loadStock } from "@/lib/stock";
import { cashflow } from "@/lib/cashflow";
import { paymentSummaries, summarize } from "@/lib/payments";
import { computed, listing, paged, pickedCount, type ExportEntity, type WithDeleted } from "@/lib/export/define";
import {
  exportActivitiesQuery,
  exportDealItemsQuery,
  exportDealsQuery,
  exportInstalmentsQuery,
  exportInvoicesQuery,
  exportNoFilters,
  exportStockQuery,
  exportOrganizationsQuery,
  exportPaymentsQuery,
  exportTasksQuery,
} from "@/lib/validations/crm";

/**
 * The everyday areas anyone can export (their own rows; admins everything).
 *
 * Every area selects only the fields it lists (Prisma `select`, never `include` or a whole row),
 * so a field added to the schema later cannot leak into a file by accident, and secrets (password
 * hashes, MFA secrets, tokens, sessions) are not reachable from here at all. Rows are scoped with the
 * same helpers as the list screens (`ownerScope`, `authorScope`, `taskScope`, `liveFilter`).
 * Customers appear by name only: no email, phone or address. The contacts table itself, and the
 * audit log, are in admin-entities.ts.
 * Money is written per row next to its own currency and never added up across currencies.
 */

const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));
const name = (p: { name: string } | null | undefined) => p?.name ?? "";
const customer = (c: { firstName: string; lastName: string } | null | undefined) =>
  c ? `${c.firstName} ${c.lastName}` : "";
const round2 = (x: number) => Math.round(x * 100) / 100;
/** Deals the caller may see: the same rule as the deals list. Deleted ones only when an admin asked for them. */
const visibleDeal = (user: SessionUser, includeDeleted?: boolean): Prisma.DealWhereInput => ({
  AND: [liveFilter(user, includeDeleted), ownerScope(user)],
});
/** `visibleDeal`, narrowed to the deals picked on screen when `dealIds` is given (still only deals the caller may see). */
const dealsIn = (user: SessionUser, q: { includeDeleted?: boolean; dealIds?: string[] }): Prisma.DealWhereInput => {
  const visible = visibleDeal(user, q.includeDeleted);
  // Without a pick the filter is exactly what it always was; with one, the pick is added to the same list.
  return q.dealIds ? { AND: [...(visible.AND as Prisma.DealWhereInput[]), { id: { in: q.dealIds } }] } : visible;
};
const person = { select: { name: true } } as const;
const contactName = { select: { firstName: true, lastName: true } } as const;

// ─── Organizations ──────────────────────────────────────

const orgSelect = {
  id: true, name: true, domain: true, industry: true, size: true, website: true, phone: true,
  address: true, city: true, state: true, country: true, deletedAt: true, createdAt: true, updatedAt: true,
  owner: person,
} satisfies Prisma.OrganizationSelect;

const orgWhere = (user: SessionUser, q: WithDeleted<z.infer<typeof exportOrganizationsQuery>>): Prisma.OrganizationWhereInput => ({
  AND: [
    liveFilter(user, q.includeDeleted),
    ownerScope(user),
    {
      ...(q.ids && { id: { in: q.ids } }),
      ...(q.industry && { industry: { equals: q.industry, mode: "insensitive" } }),
      ...(q.ownerId && { ownerId: q.ownerId }),
      ...(q.q && {
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { domain: { contains: q.q, mode: "insensitive" } },
        ],
      }),
    },
  ],
});

const organizations = listing({
  file: "organizations",
  softDeleted: true,
  schema: exportOrganizationsQuery,
  count: (user, q) => db.organization.count({ where: orgWhere(user, q) }),
  fetch: (user, q, page) =>
    db.organization.findMany({
      where: orgWhere(user, q),
      select: orgSelect,
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (o) => o.id], ["name", (o) => o.name], ["domain", (o) => o.domain], ["industry", (o) => o.industry],
    ["size", (o) => o.size], ["website", (o) => o.website], ["phone", (o) => o.phone], ["address", (o) => o.address],
    ["city", (o) => o.city], ["state", (o) => o.state], ["country", (o) => o.country], ["owner", (o) => name(o.owner)],
    ["deletedAt", (o) => o.deletedAt], ["createdAt", (o) => o.createdAt], ["updatedAt", (o) => o.updatedAt],
  ],
});

// ─── Deals, their items, payments and instalments ───────

const dealSelect = {
  id: true, title: true, stage: true, amount: true, currency: true, probability: true,
  expectedCloseDate: true, closedAt: true, lostReason: true, productType: true, texture: true,
  lengthInches: true, color: true, laceType: true, quantity: true, deletedAt: true, createdAt: true, updatedAt: true,
  organization: person, contact: contactName, owner: person,
} satisfies Prisma.DealSelect;

const dealWhere = (user: SessionUser, q: WithDeleted<z.infer<typeof exportDealsQuery>>): Prisma.DealWhereInput => ({
  AND: [
    liveFilter(user, q.includeDeleted),
    ownerScope(user),
    {
      ...(q.ids && { id: { in: q.ids } }),
      ...(q.stage && { stage: { in: q.stage } }),
      ...(q.organizationId && { organizationId: q.organizationId }),
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.ownerId && { ownerId: q.ownerId }),
      ...((q.minAmount !== undefined || q.maxAmount !== undefined) && { amount: { gte: q.minAmount, lte: q.maxAmount } }),
      ...((q.closeAfter || q.closeBefore) && { expectedCloseDate: { gte: q.closeAfter, lte: q.closeBefore } }),
      ...(q.q && { title: { contains: q.q, mode: "insensitive" } }),
    },
  ],
});

const deals = listing({
  file: "deals",
  softDeleted: true,
  schema: exportDealsQuery,
  count: (user, q) => db.deal.count({ where: dealWhere(user, q) }),
  fetch: (user, q, page) =>
    db.deal.findMany({
      where: dealWhere(user, q),
      select: dealSelect,
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      ...page,
    }),
  prepare: (rows) => paymentSummaries(rows),
  columns: [
    ["id", (d) => d.id], ["title", (d) => d.title], ["stage", (d) => d.stage], ["amount", (d) => n(d.amount)],
    ["currency", (d) => d.currency],
    ["paid", (d, p) => p.get(d.id)?.paid], ["balance", (d, p) => p.get(d.id)?.balance],
    ["nextDueDate", (d, p) => p.get(d.id)?.nextDue?.dueDate],
    ["overdue", (d, p) => (p.get(d.id)?.overdue ? "yes" : "no")],
    ["probability", (d) => d.probability], ["expectedCloseDate", (d) => d.expectedCloseDate],
    ["closedAt", (d) => d.closedAt], ["lostReason", (d) => d.lostReason],
    ["customer", (d) => customer(d.contact)], ["organization", (d) => name(d.organization)],
    ["owner", (d) => name(d.owner)],
    ["productType", (d) => d.productType], ["texture", (d) => d.texture], ["lengthInches", (d) => d.lengthInches],
    ["color", (d) => d.color], ["laceType", (d) => d.laceType], ["quantity", (d) => d.quantity],
    ["deletedAt", (d) => d.deletedAt], ["createdAt", (d) => d.createdAt], ["updatedAt", (d) => d.updatedAt],
  ],
});

const dealItems = listing({
  file: "deal-items",
  softDeleted: true,
  schema: exportDealItemsQuery,
  count: (user, q) =>
    db.dealItem.count({ where: { deal: dealsIn(user, q), ...(q.dealId && { dealId: q.dealId }) } }),
  fetch: (user, q, page) =>
    db.dealItem.findMany({
      where: { deal: dealsIn(user, q), ...(q.dealId && { dealId: q.dealId }) },
      select: {
        id: true, dealId: true, position: true, productType: true, texture: true, lengthInches: true,
        color: true, laceType: true, quantity: true, unitPrice: true, note: true,
        deal: { select: { title: true, currency: true } },
      },
      orderBy: [{ dealId: "asc" }, { position: "asc" }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["dealId", (i) => i.dealId], ["dealTitle", (i) => i.deal.title], ["position", (i) => i.position],
    ["productType", (i) => i.productType], ["texture", (i) => i.texture], ["lengthInches", (i) => i.lengthInches],
    ["color", (i) => i.color], ["laceType", (i) => i.laceType], ["quantity", (i) => i.quantity],
    ["unitPrice", (i) => n(i.unitPrice)], ["lineTotal", (i) => round2(i.quantity * Number(i.unitPrice))],
    ["currency", (i) => i.deal.currency], ["note", (i) => i.note],
  ],
});

const paymentWhere = (user: SessionUser, q: WithDeleted<z.infer<typeof exportPaymentsQuery>>): Prisma.PaymentWhereInput => ({
  deal: dealsIn(user, q),
  ...(q.dealId && { dealId: q.dealId }),
  ...((q.from || q.to) && { paidAt: { gte: q.from, lte: q.to } }),
});

const payments = listing({
  file: "payments",
  softDeleted: true,
  schema: exportPaymentsQuery,
  count: (user, q) => db.payment.count({ where: paymentWhere(user, q) }),
  fetch: (user, q, page) =>
    db.payment.findMany({
      where: paymentWhere(user, q),
      select: {
        id: true, dealId: true, amount: true, paidAt: true, method: true, reference: true, note: true, createdAt: true,
        deal: { select: { title: true, currency: true } },
        recordedBy: person,
      },
      orderBy: [{ paidAt: "desc" }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (p) => p.id], ["dealId", (p) => p.dealId], ["dealTitle", (p) => p.deal.title],
    ["amount", (p) => n(p.amount)], ["currency", (p) => p.deal.currency], ["paidAt", (p) => p.paidAt],
    ["method", (p) => p.method], ["reference", (p) => p.reference], ["note", (p) => p.note],
    ["recordedBy", (p) => name(p.recordedBy)], ["createdAt", (p) => p.createdAt],
  ],
});

/** Instalments with how much of each the payments so far cover (oldest first, as everywhere else). */
const instalments: ExportEntity = {
  file: "instalments",
  adminOnly: false,
  stepUp: false,
  softDeleted: true,
  async plan(user, req, opts) {
    const q = readQuery(req, exportInstalmentsQuery);
    const visible = dealsIn(user, { includeDeleted: opts.includeDeleted, dealIds: q.dealIds });
    return {
      total: await db.instalment.count({ where: { deal: visible, ...(q.dealId && { dealId: q.dealId }) } }),
      headers: ["dealId", "dealTitle", "position", "dueDate", "amount", "covered", "overdue", "currency"],
      filters: pickedCount({ ...q, includeDeleted: opts.includeDeleted }),
      async *batches() {
        const where: Prisma.DealWhereInput = {
          AND: [visible, q.dealId ? { id: q.dealId } : {}, { instalments: { some: {} } }],
        };
        for await (const batch of paged((page) =>
          db.deal.findMany({
            where,
            select: {
              id: true, title: true, amount: true, currency: true,
              instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
            },
            orderBy: { id: "asc" },
            ...page,
          }),
        )) {
          const sums = await db.payment.groupBy({
            by: ["dealId"],
            where: { dealId: { in: batch.map((d) => d.id) } },
            _sum: { amount: true },
          });
          const paid = new Map(sums.map((s) => [s.dealId, Number(s._sum.amount ?? 0)]));
          yield batch.flatMap((d) =>
            summarize(Number(d.amount), paid.get(d.id) ?? 0, d.instalments).instalments.map((i) => [
              d.id, d.title, i.position, i.dueDate, i.amount, i.covered, i.overdue ? "yes" : "no", d.currency,
            ]),
          );
        }
      },
    };
  },
};

// ─── Invoices (supplier purchases) ──────────────────────

const invoiceWhere = (user: SessionUser, q: z.infer<typeof exportInvoicesQuery>): Prisma.InvoiceWhereInput => ({
  ...ownerScope(user),
  ...(q.ids && { id: { in: q.ids } }),
  ...(q.status && { status: q.status }),
  ...(q.q && {
    OR: [
      { number: { contains: q.q, mode: "insensitive" } },
      { billTo: { contains: q.q, mode: "insensitive" } },
      { vendorName: { contains: q.q, mode: "insensitive" } },
    ],
  }),
});

const invoices = listing({
  file: "invoices",
  schema: exportInvoicesQuery,
  count: (user, q) => db.invoice.count({ where: invoiceWhere(user, q) }),
  fetch: (user, q, page) =>
    db.invoice.findMany({
      where: invoiceWhere(user, q),
      select: {
        id: true, number: true, status: true, invoiceDate: true, currency: true, vendorName: true,
        vendorRep: true, vendorPhone: true, billTo: true, subtotal: true, shipping: true, total: true,
        notes: true, createdAt: true, updatedAt: true,
        owner: person,
        deals: { where: { deletedAt: null }, select: { title: true }, orderBy: { title: "asc" } },
      },
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (i) => i.id], ["number", (i) => i.number], ["status", (i) => i.status], ["invoiceDate", (i) => i.invoiceDate],
    ["currency", (i) => i.currency], ["vendorName", (i) => i.vendorName], ["vendorRep", (i) => i.vendorRep],
    ["vendorPhone", (i) => i.vendorPhone], ["billTo", (i) => i.billTo],
    ["subtotal", (i) => n(i.subtotal)], ["shipping", (i) => n(i.shipping)], ["total", (i) => n(i.total)],
    ["linkedDeals", (i) => i.deals.map((d) => d.title).join("; ")], ["notes", (i) => i.notes],
    ["owner", (i) => name(i.owner)], ["createdAt", (i) => i.createdAt], ["updatedAt", (i) => i.updatedAt],
  ],
});

const invoiceItems = listing({
  file: "invoice-items",
  schema: exportInvoicesQuery,
  count: (user, q) => db.invoiceItem.count({ where: { invoice: invoiceWhere(user, q) } }),
  fetch: (user, q, page) =>
    db.invoiceItem.findMany({
      where: { invoice: invoiceWhere(user, q) },
      select: {
        id: true, position: true, ref: true, style: true, description: true, color: true, density: true,
        lengthInches: true, quantity: true, unitPrice: true, lineTotal: true, resalePrice: true, note: true,
        invoice: { select: { number: true, status: true, currency: true } },
      },
      orderBy: [{ invoice: { invoiceDate: "desc" } }, { invoiceId: "asc" }, { position: "asc" }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["invoiceNumber", (i) => i.invoice.number], ["status", (i) => i.invoice.status], ["position", (i) => i.position],
    ["ref", (i) => i.ref], ["style", (i) => i.style], ["description", (i) => i.description], ["color", (i) => i.color],
    ["density", (i) => i.density], ["lengthInches", (i) => i.lengthInches], ["quantity", (i) => i.quantity],
    ["unitPrice", (i) => n(i.unitPrice)], ["lineTotal", (i) => n(i.lineTotal)], ["resalePrice", (i) => n(i.resalePrice)],
    ["currency", (i) => i.invoice.currency], ["note", (i) => i.note],
  ],
});

// ─── Tasks and activities ───────────────────────────────

const taskWhere = (user: SessionUser, q: z.infer<typeof exportTasksQuery>): Prisma.TaskWhereInput => ({
  AND: [
    taskScope(user),
    {
      ...(q.ids && { id: { in: q.ids } }),
      ...(q.status && { status: { in: q.status } }),
      ...(q.priority && { priority: { in: q.priority } }),
      ...(q.assigneeId && { assigneeId: q.assigneeId }),
      ...(q.createdById && { createdById: q.createdById }),
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.dealId && { dealId: q.dealId }),
      ...((q.dueAfter || q.dueBefore) && { dueDate: { gte: q.dueAfter, lte: q.dueBefore } }),
      ...(q.overdue && { dueDate: { lt: new Date() }, status: { in: ["TODO", "IN_PROGRESS"] } }),
      ...(q.q && { title: { contains: q.q, mode: "insensitive" } }),
    },
  ],
});

const tasks = listing({
  file: "tasks",
  schema: exportTasksQuery,
  count: (user, q) => db.task.count({ where: taskWhere(user, q) }),
  fetch: (user, q, page) =>
    db.task.findMany({
      where: taskWhere(user, q),
      select: {
        id: true, title: true, description: true, status: true, priority: true, dueDate: true,
        completedAt: true, createdAt: true,
        assignee: person, createdBy: person, contact: contactName, deal: { select: { title: true } },
      },
      orderBy: [{ [q.sort]: q.sort === "dueDate" ? { sort: q.order, nulls: "last" } : q.order }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (t) => t.id], ["title", (t) => t.title], ["description", (t) => t.description], ["status", (t) => t.status],
    ["priority", (t) => t.priority], ["dueDate", (t) => t.dueDate], ["completedAt", (t) => t.completedAt],
    ["assignee", (t) => name(t.assignee)], ["createdBy", (t) => name(t.createdBy)],
    ["customer", (t) => customer(t.contact)], ["deal", (t) => t.deal?.title], ["createdAt", (t) => t.createdAt],
  ],
});

const activityWhere = (user: SessionUser, q: z.infer<typeof exportActivitiesQuery>): Prisma.ActivityWhereInput => ({
  AND: [
    authorScope(user),
    {
      ...(q.ids && { id: { in: q.ids } }),
      ...(q.type && { type: { in: q.type } }),
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.dealId && { dealId: q.dealId }),
      ...(q.organizationId && { organizationId: q.organizationId }),
      ...(q.authorId && { authorId: q.authorId }),
      ...((q.from || q.to) && { occurredAt: { gte: q.from, lte: q.to } }),
      ...(q.q && {
        OR: [
          { subject: { contains: q.q, mode: "insensitive" } },
          { body: { contains: q.q, mode: "insensitive" } },
        ],
      }),
    },
  ],
});

const activities = listing({
  file: "activities",
  schema: exportActivitiesQuery,
  count: (user, q) => db.activity.count({ where: activityWhere(user, q) }),
  fetch: (user, q, page) =>
    db.activity.findMany({
      where: activityWhere(user, q),
      select: {
        id: true, type: true, subject: true, body: true, occurredAt: true, createdAt: true,
        author: person, contact: contactName, deal: { select: { title: true } }, organization: person,
      },
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (a) => a.id], ["type", (a) => a.type], ["subject", (a) => a.subject], ["body", (a) => a.body],
    ["occurredAt", (a) => a.occurredAt], ["author", (a) => name(a.author)], ["customer", (a) => customer(a.contact)],
    ["deal", (a) => a.deal?.title], ["organization", (a) => name(a.organization)], ["createdAt", (a) => a.createdAt],
  ],
});

// ─── Stock and cash flow ────────────────────────────────

const stock = computed({
  file: "stock",
  schema: exportStockQuery,
  headers: ["product", "description", "color", "lengthInches", "bought", "sold", "adjusted", "onHand", "invoices"],
  rows: async (user, q) =>
    (await loadStock(ownerScope(user))).rows
      // Only the rows picked on screen (named product|colour|length), out of the rows this person can already see.
      .filter((r) => !q.keys || q.keys.includes(`${r.product}|${r.color}|${r.lengthInches}`))
      .map((r) => [
      r.product, r.description, r.color, r.lengthInches, r.bought, r.sold, r.adjusted, r.onHand,
      r.sources.map((s) => s.number).join("; "),
    ]),
});

/** One row per figure and currency, so currencies are never added together. */
const cash = computed({
  file: "cashflow",
  schema: exportNoFilters,
  headers: ["figure", "currency", "amount"],
  rows: async (user) => {
    const c = await cashflow(ownerScope(user));
    const out: unknown[][] = [];
    const money = (figure: string, m: Record<string, number>) => {
      for (const [currency, amount] of Object.entries(m).sort(([a], [b]) => a.localeCompare(b))) {
        out.push([figure, currency, amount]);
      }
    };
    money("Collected (all time)", c.collected.total);
    money("Collected (last 30 days)", c.collected.last30Days);
    money("Owed", c.owed.amount);
    money("Overdue", c.overdue.amount);
    for (const [currency, p] of Object.entries(c.profit).sort(([a], [b]) => a.localeCompare(b))) {
      out.push(["Resale revenue", currency, p.revenue], ["Cost", currency, p.cost], ["Estimated profit", currency, p.estimated]);
    }
    return out;
  },
});

export const AREA_EXPORTS: Readonly<Record<string, ExportEntity>> = {
  organizations,
  deals,
  "deal-items": dealItems,
  payments,
  instalments,
  invoices,
  "invoice-items": invoiceItems,
  stock,
  tasks,
  activities,
  cashflow: cash,
};
