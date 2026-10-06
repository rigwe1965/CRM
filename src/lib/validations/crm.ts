import { z } from "zod";
import {
  ActivityType,
  ContactType,
  DealStage,
  LeadStatus,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";

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
  organizationId: id.optional(),
  ownerId: id.optional(),
  includeDeleted: bool.optional(),
});

// ─── Deals ──────────────────────────────────────────────

const amount = z
  .number()
  .min(0)
  .max(999_999_999_999)
  .transform((n) => Math.round(n * 100) / 100);
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
export const dealListQuery = z.object({
  ...pagination,
  sort: z
    .enum(["title", "amount", "stage", "probability", "expectedCloseDate", "createdAt", "updatedAt"])
    .default("createdAt"),
  stage: csv(z.enum(DealStage)).optional(),
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

// ─── Activities ─────────────────────────────────────────

const activityFields = z.object({
  type: z.enum(ActivityType).optional(),
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
});
