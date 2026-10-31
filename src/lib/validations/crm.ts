import { z } from "zod";
import {
  ActivityDirection,
  ActivityType,
  ContactType,
  DealStage,
  InvoiceStatus,
  LeadStatus,
  PaymentMethod,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { SLOT_SOURCE_KEYS } from "@/lib/whatsapp-template-slots";
import { FULFILMENT_STATUSES } from "@/lib/fulfilment";

// ─── Field helpers ──────────────────────────────────────

const id = z.string().trim().min(1).max(40);
const requiredText = (max = 200) => z.string().trim().min(1, "Required").max(max);
/** Optional text; "" becomes null; null clears the value on update. */
const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();
const emailField = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).nullish();
// http(s) only: the value may later be rendered as a link.
const urlField = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), "Must be an http(s) URL")
  .nullish();
const isoDate = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((s) => new Date(s));
const nullableDate = isoDate.nullish();

const nonEmpty = (v: object) => Object.values(v).some((x) => x !== undefined);
const atLeastOne = { message: "Provide at least one field to update" };

// ─── Query helpers ──────────────────────────────────────

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
/** Comma-separated list of enum values, e.g. ?stage=PROPOSAL,NEGOTIATION */
const csv = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(item).min(1));

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().trim().max(100).optional(),
};

export const idParam = z.object({ id });

// ─── Organizations ──────────────────────────────────────

const organizationFields = z.object({
  name: requiredText(200),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a bare domain such as acme.com")
    .nullish(),
  industry: text(100),
  size: z.number().int().min(0).max(10_000_000).nullish(),
  website: urlField,
  phone: text(40),
  address: text(200),
  city: text(100),
  state: text(100),
  country: text(100),
  ownerId: id.nullish(),
});
export const createOrganizationSchema = organizationFields;
export const updateOrganizationSchema = organizationFields.partial().refine(nonEmpty, atLeastOne);
export const organizationListQuery = z.object({
  ...pagination,
  sort: z.enum(["name", "industry", "createdAt", "updatedAt"]).default("createdAt"),
  industry: z.string().trim().max(100).optional(),
  ownerId: id.optional(),
  includeDeleted: bool.optional(),
});

// ─── Contacts ───────────────────────────────────────────

const contactFields = z.object({
  firstName: requiredText(100),
  lastName: requiredText(100),
  email: emailField,
  phone: text(40),
  title: text(100),
  type: z.enum(ContactType).optional(),
  leadStatus: z.enum(LeadStatus).nullish(),
  source: text(100),
  address: text(200),
  city: text(100),
  state: text(100),
  postalCode: text(20),
  country: text(100),
  emailOptOut: z.boolean().optional(),
  whatsappOptIn: z.boolean().optional(),
  /** The contact's tags, as a whole: the list replaces whatever it had. */
  tagIds: z.array(id).max(20).optional(),
  organizationId: id.nullish(),
  ownerId: id.nullish(),
});
export const createContactSchema = contactFields.extend({ type: z.enum(ContactType).default("LEAD") });
export const updateContactSchema = contactFields.partial().refine(nonEmpty, atLeastOne);
export const contactListQuery = z.object({
  ...pagination,
  sort: z.enum(["name", "type", "leadStatus", "createdAt", "updatedAt"]).default("createdAt"),
  type: csv(z.enum(ContactType)).optional(),
  leadStatus: csv(z.enum(LeadStatus)).optional(),
  tag: id.optional(),
  organizationId: id.optional(),
  ownerId: id.optional(),
  includeDeleted: bool.optional(),
});

// ─── Tags and saved filters ─────────────────────────────

const tagName = z.string().trim().min(1, "Required").max(40);
/** Asks "does a contact like this already exist?": matches on phone number or on first + last name. */
export const duplicateQuery = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  excludeId: id.optional(),
});
/** Admin merge: the contact in the URL is folded into `intoId` and removed. */
export const mergeContactSchema = z.object({ intoId: id });
/** Public website form. `website` is a honeypot: people never see it, bots fill it in. */
export const webLeadSchema = z
  .object({
    name: z.string().trim().min(1, "Please enter your name").max(100),
    email: z.union([z.literal(""), z.email("Please enter a valid email address").max(200)]).optional(),
    phone: z.string().trim().max(40).optional(),
    message: z.string().trim().max(2000).optional(),
    website: z.string().max(200).optional(),
    captchaToken: z.string().max(4096).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: "Please give an email address or a phone number" });
  });
export const sendWhatsappSchema = z.object({ message: z.string().trim().min(1, "Write a message").max(1000, "Keep it under 1000 characters") });
export const leadFormSettingsSchema = z.object({ ownerId: id.nullable() });
export const createTagSchema = z.object({ name: tagName });
export const updateTagSchema = z.object({ name: tagName });

const savedFilterEntity = z.enum(["contacts"]);
/** The contacts-list filters a view can remember (what the page puts in the URL query). */
const savedFilterQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.string().trim().max(100).optional(),
  leadStatus: z.string().trim().max(100).optional(),
  tag: id.optional(),
});
export const createSavedFilterSchema = z.object({ entity: savedFilterEntity, name: requiredText(40), query: savedFilterQuery });
export const savedFilterListQuery = z.object({ entity: savedFilterEntity.default("contacts") });

// ─── Deals ──────────────────────────────────────────────

const amount = z
  .number()
  .min(0)
  .max(999_999_999_999)
  .transform((n) => Math.round(n * 100) / 100);
const dealItemSchema = z.object({
  productType: requiredText(100),
  texture: text(100),
  lengthInches: text(100),
  color: text(100),
  laceType: text(100),
  quantity: z.number().int().min(1).max(100_000),
  unitPrice: amount,
  note: text(200),
});
const dealFields = z.object({
  title: requiredText(200),
  amount: amount.optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code")
    .transform((v) => v.toUpperCase())
    .optional(),
  stage: z.enum(DealStage).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: nullableDate,
  lostReason: text(500),
  productType: text(100),
  texture: text(100),
  lengthInches: text(100),
  color: text(100),
  laceType: text(100),
  quantity: z.number().int().min(1).max(100_000).nullish(),
  organizationId: id.nullish(),
  contactId: id.nullish(),
  ownerId: id.optional(),
  // What was bought. When present (even empty on update) these replace the existing lines and set the amount.
  items: z.array(dealItemSchema).max(100).optional(),
});
export const createDealSchema = dealFields.extend({
  amount: amount.default(0),
  currency: dealFields.shape.currency.default("USD"),
  stage: z.enum(DealStage).default("QUALIFICATION"),
});
export const updateDealSchema = dealFields.partial().refine(nonEmpty, atLeastOne);
export const dealStageSchema = z.object({
  stage: z.enum(DealStage),
  probability: z.number().int().min(0).max(100).optional(),
  lostReason: text(500),
});
export const dealFulfilmentSchema = z
  .object({
    status: z.enum(FULFILMENT_STATUSES).optional(),
    carrier: text(60),
    trackingNumber: text(100).refine((v) => !v || !/\s/.test(v), "A tracking number has no spaces"),
  })
  .refine(nonEmpty, atLeastOne);
export const dealListQuery = z.object({
  ...pagination,
  sort: z
    .enum(["title", "amount", "stage", "probability", "expectedCloseDate", "createdAt", "updatedAt"])
    .default("createdAt"),
  stage: csv(z.enum(DealStage)).optional(),
  fulfilment: csv(z.enum(FULFILMENT_STATUSES)).optional(),
  /** Won orders that are not on their way yet (not started or packed). */
  toShip: bool.optional(),
  organizationId: id.optional(),
  contactId: id.optional(),
  ownerId: id.optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  closeAfter: isoDate.optional(),
  closeBefore: isoDate.optional(),
  includeDeleted: bool.optional(),
});

// ─── Email ──────────────────────────────────────────────

export const sendContactEmailSchema = z.object({
  subject: requiredText(200).refine((v) => !/[\r\n]/.test(v), "Subject must be a single line"),
  message: requiredText(10_000),
});

// ─── Email templates ────────────────────────────────────

const emailTemplateFields = z.object({
  name: requiredText(80),
  subject: requiredText(200).refine((v) => !/[\r\n]/.test(v), "Subject must be a single line"),
  body: requiredText(10_000),
});
export const createEmailTemplateSchema = emailTemplateFields;
export const updateEmailTemplateSchema = emailTemplateFields.partial().refine(nonEmpty, atLeastOne);

// ─── WhatsApp templates ─────────────────────────────────

/** Send an approved template to a contact. `dealId` is the order it is about; `values[i]` fills the i-th blank when it is typed by hand. */
export const sendWhatsappTemplateSchema = z.object({
  templateId: id,
  dealId: id.optional(),
  values: z.array(z.string().max(200, "Keep it under 200 characters")).max(20).optional(),
});

// ─── Broadcast campaigns ────────────────────────────────

/**
 * Who a campaign goes to, on top of "agreed to WhatsApp, has a WhatsApp-ready number, not deleted" which always applies.
 * Empty lists mean "no restriction". `noOrderDays`: no won order created in the last N days (customers who never ordered
 * count). `paidInFull`: has at least one won order and every won order is paid in full.
 */
export const campaignAudienceSchema = z.object({
  tagIds: z.array(id).max(50).default([]),
  types: z.array(z.enum(ContactType)).max(5).default([]),
  leadStatuses: z.array(z.enum(LeadStatus)).max(4).default([]),
  sources: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  noOrderDays: z.number().int().min(1).max(3650).nullish(),
  paidInFull: z.boolean().default(false),
});
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

/** `values[i]` is the text for the i-th blank when it is typed once for everyone. */
const campaignValues = z.array(z.string().trim().max(200, "Keep it under 200 characters")).max(20);
export const createCampaignSchema = z.object({
  name: requiredText(120),
  templateId: id,
  audience: campaignAudienceSchema.default(() => campaignAudienceSchema.parse({})),
  values: campaignValues.default([]),
});
export const updateCampaignSchema = z
  .object({ name: requiredText(120), templateId: id, audience: campaignAudienceSchema, values: campaignValues })
  .partial()
  .refine(nonEmpty, atLeastOne);

/** Your own WhatsApp number, for the test message. */
export const campaignTestSchema = z.object({ phone: requiredText(30) });
/** The number of customers the admin was shown and confirmed; the campaign starts only if the audience still has exactly that many. */
export const startCampaignSchema = z.object({ expectedCount: z.number().int().min(0).max(1_000_000) });

/** An admin chooses where each blank's value comes from, or switches the template off. The wording itself comes from Meta. */
export const updateWhatsappTemplateSchema = z
  .object({
    active: z.boolean().optional(),
    slots: z.array(z.object({ label: requiredText(40), source: z.enum(SLOT_SOURCE_KEYS) })).max(20).optional(),
  })
  .refine(nonEmpty, atLeastOne);

// ─── Activities ─────────────────────────────────────────

const activityFields = z.object({
  type: z.enum(ActivityType).optional(),
  direction: z.enum(ActivityDirection).nullish(),
  subject: requiredText(200),
  body: text(10_000),
  occurredAt: isoDate.optional(),
  contactId: id.nullish(),
  dealId: id.nullish(),
  organizationId: id.nullish(),
});
export const createActivitySchema = activityFields.extend({ type: z.enum(ActivityType).default("NOTE") });
export const updateActivitySchema = activityFields.partial().refine(nonEmpty, atLeastOne);
export const activityListQuery = z.object({
  ...pagination,
  sort: z.enum(["occurredAt", "type", "createdAt"]).default("occurredAt"),
  type: csv(z.enum(ActivityType)).optional(),
  contactId: id.optional(),
  dealId: id.optional(),
  organizationId: id.optional(),
  authorId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ─── Tasks ──────────────────────────────────────────────

const taskFields = z.object({
  title: requiredText(200),
  description: text(5000),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  dueDate: nullableDate,
  assigneeId: id.optional(),
  contactId: id.nullish(),
  dealId: id.nullish(),
});
export const createTaskSchema = taskFields.extend({
  status: z.enum(TaskStatus).default("TODO"),
  priority: z.enum(TaskPriority).default("MEDIUM"),
});
export const updateTaskSchema = taskFields.partial().refine(nonEmpty, atLeastOne);
export const taskListQuery = z.object({
  ...pagination,
  sort: z.enum(["dueDate", "priority", "status", "title", "createdAt"]).default("dueDate"),
  order: z.enum(["asc", "desc"]).default("asc"),
  status: csv(z.enum(TaskStatus)).optional(),
  priority: csv(z.enum(TaskPriority)).optional(),
  assigneeId: id.optional(),
  createdById: id.optional(),
  contactId: id.optional(),
  dealId: id.optional(),
  dueAfter: isoDate.optional(),
  dueBefore: isoDate.optional(),
  overdue: bool.optional(),
});

// ─── Invoices ───────────────────────────────────────────

export const invoiceListQuery = z.object({
  ...pagination,
  sort: z.enum(["number", "invoiceDate", "total", "createdAt"]).default("invoiceDate"),
  status: z.enum(InvoiceStatus).optional(),
});

const invoiceItemSchema = z.object({
  ref: requiredText(20),
  style: requiredText(100),
  description: requiredText(200),
  color: text(60),
  density: text(60),
  lengthInches: z.number().int().min(1).max(200).nullish(),
  quantity: z.number().int().min(1).max(100_000),
  unitPrice: amount,
  // Supplier sheets round per line, so this may differ slightly from quantity x unitPrice.
  // Left out, it is computed.
  lineTotal: amount.optional(),
  resalePrice: amount.nullish(),
  note: text(200),
});
const invoiceFields = z.object({
  number: requiredText(40),
  status: z.enum(InvoiceStatus).optional(),
  invoiceDate: isoDate,
  currency: dealFields.shape.currency,
  vendorName: requiredText(200),
  vendorRep: text(100),
  vendorPhone: text(50),
  billTo: requiredText(200),
  shipping: amount.optional(),
  // Negotiated "deal price". Left out, it defaults to items + shipping.
  total: amount.optional(),
  notes: text(2000),
  items: z.array(invoiceItemSchema).min(1, "Add at least one item").max(500),
  dealIds: z.array(id).max(100).optional(),
});
export const createInvoiceSchema = invoiceFields.extend({
  status: z.enum(InvoiceStatus).default("DRAFT"),
  currency: dealFields.shape.currency.default("USD"),
});
export const updateInvoiceSchema = invoiceFields.partial().refine(nonEmpty, atLeastOne);

// ─── Payments ───────────────────────────────────────────

/** Amount defaults to everything still left to collect. */
export const createPaymentLinkSchema = z.object({
  amount: amount.refine((n) => n > 0, "Must be more than 0").optional(),
  note: text(200),
});

/** A private link for the customer to see one order. Lasts 90 days unless told otherwise (1 to 365). */
export const createCustomerLinkSchema = z.object({
  expiresInDays: z.number().int("Whole days").min(1, "At least 1 day").max(365, "At most 365 days").optional(),
});

export const sendReminderSchema = z.object({
  instalmentId: z.string().trim().min(1, "Required").max(64),
  channel: z.enum(["EMAIL", "WHATSAPP"]).default("EMAIL"),
});

export const createPaymentSchema = z.object({
  amount: amount.refine((n) => n > 0, "Must be more than 0"),
  paidAt: isoDate,
  method: z.enum(PaymentMethod).default("BANK_TRANSFER"),
  reference: text(100),
  note: text(500),
});
export const scheduleSchema = z.object({
  instalments: z
    .array(z.object({ dueDate: isoDate, amount: amount.refine((n) => n > 0, "Must be more than 0") }))
    .max(60),
});

// ─── Stock adjustments ──────────────────────────────────

const adjustmentFields = z.object({
  product: requiredText(200),
  color: z.string().trim().max(100).default(""),
  lengthInches: z.number().int().min(1).max(200).nullish(),
  // Signed: positive adds pieces, negative removes them.
  quantity: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0, "Quantity can't be zero"),
  reason: requiredText(100),
  note: text(500),
});
export const createStockAdjustmentSchema = adjustmentFields;
// The product, colour and length identify the stock row and can't be moved afterwards.
export const updateStockAdjustmentSchema = adjustmentFields
  .pick({ quantity: true, reason: true, note: true })
  .partial()
  .refine(nonEmpty, atLeastOne);

// Where a stock row counts as low. null: use the business default; 0: never alert for this row.
export const setStockLevelSchema = z.object({
  product: requiredText(200),
  color: z.string().trim().max(100).default(""),
  lengthInches: z.number().int().min(1).max(200).nullish(),
  threshold: z.number().int().min(0).max(100_000).nullable(),
});

// ─── Export ─────────────────────────────────────────────

// Same filters as the list screens, minus paging (an export is one file). Deleted rows are never
// exportable here: includeDeleted is dropped, so the filter stays `deletedAt: null`.
export const exportFormatQuery = z.object({ format: z.enum(["csv"]).default("csv") });
/**
 * Rows the person ticked on screen (`ids=a,b,c`). Optional, and it only narrows: it is ANDed with the same
 * visibility rules as the list, so an id the caller may not see simply matches nothing. Capped, deduplicated,
 * and each id must look like an id (short plain text), so nothing odd reaches a query.
 */
export const MAX_SELECTED_ROWS = 200;
const pickedIds = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(id).min(1).max(MAX_SELECTED_ROWS))
  .transform((a) => [...new Set(a)])
  .optional();
export const exportOrganizationsQuery = organizationListQuery.omit({ page: true, pageSize: true, includeDeleted: true }).extend({ ids: pickedIds });
export const exportDealsQuery = dealListQuery.omit({ page: true, pageSize: true, includeDeleted: true }).extend({ ids: pickedIds });
export const exportInvoicesQuery = invoiceListQuery.omit({ page: true, pageSize: true }).extend({ ids: pickedIds });
export const exportTasksQuery = taskListQuery.omit({ page: true, pageSize: true }).extend({ ids: pickedIds });
export const exportActivitiesQuery = activityListQuery.omit({ page: true, pageSize: true }).extend({ ids: pickedIds });
// `dealIds` (deal items, payments, instalments): only the rows of these deals, which must be deals the caller can see.
export const exportDealItemsQuery = z.object({ dealId: id.optional(), dealIds: pickedIds });
export const exportInstalmentsQuery = z.object({ dealId: id.optional(), dealIds: pickedIds });
export const exportPaymentsQuery = z.object({ dealId: id.optional(), from: isoDate.optional(), to: isoDate.optional(), dealIds: pickedIds });
export const exportNoFilters = z.object({});
/**
 * `keys` for the stock file: stock rows have no id, so a row is named by its product, colour and length
 * ("product|colour|length"), each key URL-encoded by the browser so a comma in a product name cannot split it.
 * Only used to pick from rows already loaded for the caller (matched in memory, never put in a query).
 */
export const MAX_STOCK_KEYS = 100;
export const exportStockQuery = z.object({
  keys: z
    .string()
    .transform((s) => {
      try {
        return s.split(",").map((x) => decodeURIComponent(x.trim())).filter(Boolean);
      } catch {
        return [];
      }
    })
    .pipe(z.array(z.string().max(300)).min(1).max(MAX_STOCK_KEYS))
    .transform((a) => [...new Set(a)])
    .optional(),
});
// Admin-only areas. Deleted rows are never a URL filter: they come only from the POST body below.
export const exportContactsQuery = contactListQuery.omit({ page: true, pageSize: true, includeDeleted: true }).extend({ ids: pickedIds });
export const exportAuditQuery = z.object({
  q: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
/** Ivy's spend records and chat metadata: a date range only. */
export const exportAiQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
/** Body of the POST export calls (the ones that need a fresh authenticator code). */
export const exportPostBody = z.object({
  code: z.string().trim().max(32).optional(),
  includeDeleted: z.boolean().optional(),
});
/** `lines=a,b,c`: only these line items of the invoice go into the PDF (they must belong to that invoice). */
const pickedLines = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(id).min(1).max(2000))
  .transform((a) => [...new Set(a)])
  .optional();
export const exportDocumentQuery = z.object({ format: z.enum(["pdf"]).default("pdf"), lines: pickedLines });
