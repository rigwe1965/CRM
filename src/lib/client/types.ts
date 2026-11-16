// Shapes returned by the REST API (dates arrive as ISO strings). Kept free of @prisma/client
// so client bundles never import the Prisma package.

import type { FulfilmentStatus } from "@/lib/fulfilment";

export type Role = "ADMIN" | "SALES" | "SUPPORT";
export type ContactType = "LEAD" | "PROSPECT" | "CUSTOMER" | "PARTNER" | "OTHER";
export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED";
export type DealStage =
  | "QUALIFICATION"
  | "DISCOVERY"
  | "PROPOSAL"
  | "NEGOTIATION"
  | "CLOSED_WON"
  | "CLOSED_LOST";
export type ActivityType = "NOTE" | "CALL" | "EMAIL" | "MEETING" | "WHATSAPP";
export type ActivityDirection = "IN" | "OUT";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type Person = { id: string; name: string };
export type ContactRef = { id: string; firstName: string; lastName: string };

export type Organization = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: number | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: Person | null;
  _count: { contacts: number; deals: number };
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  emailOptOut: boolean;
  whatsappOptIn: boolean;
  whatsappOptInAt?: string | null;
  whatsappOptInSource?: string | null;
  title: string | null;
  type: ContactType;
  leadStatus: LeadStatus | null;
  source: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  organizationId: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  organization: { id: string; name: string } | null;
  owner: Person | null;
  tags: { tag: { id: string; name: string } }[];
  _count: { deals: number; activities: number; tasks: number };
};

export type Deal = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  stage: DealStage;
  probability: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  fulfilmentStatus: FulfilmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  productType: string | null;
  texture: string | null;
  lengthInches: string | null;
  color: string | null;
  laceType: string | null;
  quantity: number | null;
  organizationId: string | null;
  contactId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  organization: { id: string; name: string } | null;
  contact: ContactRef | null;
  owner: Person;
  items?: DealItem[];
  /** Only on the deals list. */
  payments?: PaymentSummary;
};

export type DealItem = {
  id: string;
  position: number;
  productType: string;
  texture: string | null;
  lengthInches: string | null;
  color: string | null;
  laceType: string | null;
  quantity: number;
  unitPrice: number;
  note: string | null;
};

export type PaymentMethod = "BANK_TRANSFER" | "CASH" | "DIGITAL" | "OTHER";

export type PaymentSummary = {
  paid: number;
  balance: number;
  nextDue: { dueDate: string; amount: number } | null;
  overdue: boolean;
};

export type Payment = {
  id: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  source: "MANUAL" | "ONLINE";
  /** Null for online payments: nobody typed them in. */
  recordedBy: Person | null;
};

export type Tag = { id: string; name: string; createdAt: string };
export type Reports = {
  months: number;
  revenueByMonth: { month: string; revenue: MoneyMap }[];
  daysToPay: { average: number | null; deals: number };
  topProducts: { product: string; pieces: number; revenue: MoneyMap }[];
  leadsBySource: { source: string; contacts: number; customers: number; conversion: number }[];
};
/** GET /api/admin/assistant: AI's state for the admin screen. Never contains the key. */
export type AssistantStatus = {
  model: string;
  modelOptions: { id: string; label: string; blurb: string }[];
  keyConfigured: boolean;
  keySource: "settings" | "env" | null;
  /** Included AI (INCLUDED_AI_PLAN.md). `eligible` is false unless the owner has switched it on and the plan includes some. */
  included: { eligible: boolean; allowanceUsd: number; allowanceUsedUsd: number; creditUsd: number; leftUsd: number; canBuy: boolean; packs: { id: string; priceUsd: number; creditUsd: number }[] };
  enabled: boolean;
  proposalsEnabled: boolean;
  paymentProposalsEnabled: boolean;
  inboxEnabled: boolean;
  triageEnabled: boolean;
  triageDailyCap: number;
  documentsEnabled: boolean;
  documentsDailyCap: number;
  spentByPurposeUsd: { chat: number; inbox: number; triage: number; documents: number };
  monthlyCeilingUsd: number | null;
  level: "unset" | "ok" | "warn" | "reached";
  spentUsd: number;
  ceilingUsd: number | null;
  percent: number | null;
  resetsOn: string;
  retentionDays: number;
};
export type ReconcileFinding = {
  kind: string;
  severity: "high" | "low";
  dealId: string;
  dealTitle: string;
  currency: string;
  detail: string;
  fix: string;
};
export type ReconcileReport = { checked: number; findings: ReconcileFinding[]; truncated: boolean; counts: Record<string, number> };
export type DuplicateMatch = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; type: string; reasons: string[] };
export type SavedFilter = {
  id: string;
  name: string;
  entity: "contacts";
  query: { q?: string; type?: string; leadStatus?: string; tag?: string };
};

export type EmailTemplate = { id: string; name: string; subject: string; body: string; createdAt: string; updatedAt: string };

export type WhatsappTemplateSlot = { label: string; source: "firstName" | "fullName" | "dealTitle" | "amountDue" | "dueDate" | "orderLink" | "trackingNumber" | "manual" };
export type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: string;
  supported: boolean;
  active: boolean;
  slots: WhatsappTemplateSlot[];
  lastSyncedAt: string;
};

export type StageRule = { enabled: boolean; title: string; dueInDays: number; priority: TaskPriority };
export type StageTasksConfig = { enabled: boolean; stages: Record<DealStage, StageRule> };
export type QuietLeadsConfig = { enabled: boolean; days: number };
export type LowStockConfig = { enabled: boolean; defaultThreshold: number };
export type ShippingStep = { enabled: boolean; templateId: string };
export type ShippingUpdatesConfig = { enabled: boolean; shipped: ShippingStep; delivered: ShippingStep };

export type ReminderWording = { subject: string; message: string };
export type InstalmentEmailsConfig = {
  enabled: boolean;
  mode: "TEST" | "LIVE";
  testEmail: string;
  brandName: string;
  daysBefore: number;
  firstOverdueDays: number;
  secondOverdueDays: number;
  wording: Record<"UPCOMING" | "OVERDUE_1" | "OVERDUE_2", ReminderWording>;
  whatsapp: {
    enabled: boolean;
    language: string;
    testPhone: string;
    templates: Record<"UPCOMING" | "OVERDUE_1" | "OVERDUE_2", string>;
  };
};
export type AutomationsView = {
  stageTasks: StageTasksConfig;
  quietLeads: QuietLeadsConfig;
  instalmentEmails: InstalmentEmailsConfig;
  lowStock: LowStockConfig;
  shippingUpdates: ShippingUpdatesConfig;
  /** Contacts that would get a follow-up task on the next daily run. */
  quietLeadsWouldCreate: number;
  /** Stock rows that are at or below their level right now, business-wide. */
  lowStockNow: number;
  /** Customer emails that would go out on the next daily run (to the test address in test mode). */
  instalmentEmailsWouldSend: number;
  /** WhatsApp reminders the next daily run would send (customers who opted in). */
  instalmentWhatsappsWouldSend: number;
};

export type PaymentLinkStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUND_NEEDED";

export type PaymentLink = {
  id: string;
  amount: number;
  currency: string;
  status: PaymentLinkStatus;
  url: string | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
  createdBy: Person;
};

export type CustomerLink = {
  id: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  url: string | null;
  createdAt: string;
  expiresAt: string;
  lastViewedAt: string | null;
  viewCount: number;
};

export type PaymentLinksView = { configured: boolean; links: PaymentLink[] };

export type ReminderKind = "UPCOMING" | "OVERDUE_1" | "OVERDUE_2";

export type InstalmentReminder = {
  id: string;
  kind: ReminderKind;
  test: boolean;
  channel: "EMAIL" | "WHATSAPP";
  recipient: string;
  sentAt: string;
  position: number;
  dueDate: string;
};

export type RemindersView = { mode: "TEST" | "LIVE"; canEmail: boolean; canWhatsapp: boolean; reminders: InstalmentReminder[] };

export type InstalmentStatus = {
  id: string;
  position: number;
  dueDate: string;
  amount: number;
  covered: number;
  overdue: boolean;
};

export type PaymentsView = {
  dealAmount: number;
  currency: string;
  summary: PaymentSummary;
  instalments: InstalmentStatus[];
  payments: Payment[];
};

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurredAt: string;
  direction: ActivityDirection | null;
  /** Outgoing WhatsApp only: what Meta last reported. Null until it reports. */
  deliveryStatus?: "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
  deliveryError?: string | null;
  authorId: string;
  contactId: string | null;
  dealId: string | null;
  organizationId: string | null;
  author: Person;
  contact: ContactRef | null;
  deal: { id: string; title: string } | null;
  organization: { id: string; name: string } | null;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  assigneeId: string;
  createdById: string;
  contactId: string | null;
  dealId: string | null;
  assignee: Person;
  createdBy: Person;
  contact: ContactRef | null;
  deal: { id: string; title: string } | null;
};

export type TeamUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  hasPassword: boolean;
  mfaEnabled: boolean;
};

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "CANCELLED";

export type InvoiceItem = {
  id: string;
  position: number;
  ref: string;
  style: string;
  description: string;
  color: string | null;
  density: string | null;
  lengthInches: number | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  resalePrice: number | null;
  note: string | null;
};

export type Invoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  invoiceDate: string;
  currency: string;
  vendorName: string;
  vendorRep: string | null;
  vendorPhone: string | null;
  billTo: string;
  subtotal: number;
  shipping: number;
  total: number;
  notes: string | null;
  owner: Person;
  deals: { id: string; title: string }[];
  items?: InvoiceItem[];
  _count?: { items: number };
};

export type Paginated<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

import type { MoneyMap } from "@/lib/money";

export type { MoneyMap };

export type PipelineStage = { stage: DealStage; count: number; amount: MoneyMap; weightedAmount: MoneyMap };

export type Dashboard = {
  counts: {
    contacts: number;
    contactsByType: Partial<Record<ContactType, number>>;
    organizations: number;
    openDeals: number;
    openTasks: number;
    overdueTasks: number;
  };
  pipeline: {
    stages: PipelineStage[];
    openCount: number;
    openAmount: MoneyMap;
    openWeightedAmount: MoneyMap;
  };
  revenue: {
    wonTotal: MoneyMap;
    wonDealsTotal: number;
    wonLast30Days: MoneyMap;
    wonDealsLast30Days: number;
    winRate: number | null;
  };
  stock: { invoiceCount: number; spend: MoneyMap; pieces: number };
  cashflow: {
    collected: { total: MoneyMap; last30Days: MoneyMap };
    owed: { amount: MoneyMap; deals: number };
    overdue: { amount: MoneyMap; deals: number };
    /** Per invoice currency. */
    profit: Record<string, { estimated: number; revenue: number; cost: number; margin: number | null }>;
  };
  recentActivities: Activity[];
  upcomingTasks: Task[];
};

export type StockAdjustment = { id: string; quantity: number; reason: string; note: string | null; createdAt: string };
export type StockRow = {
  key: string;
  /** This row's own low-stock level; null = the business default, 0 = never alert. */
  threshold: number | null;
  /** The level the row is held to (its own, else the default). */
  level: number;
  low: boolean;
  product: string;
  description: string;
  color: string;
  lengthInches: number | null;
  bought: number;
  sold: number;
  adjusted: number;
  onHand: number;
  adjustments: StockAdjustment[];
  sources: { invoiceId: string; number: string }[];
};

export type UnmatchedSale = { dealId: string; dealTitle: string; product: string; color: string; length: string; quantity: number; reason: string };

export type Stock = { rows: StockRow[]; unmatched: UnmatchedSale[]; defaultThreshold: number; alertsOn: boolean };

export type SessionUser = { id: string; tenantId: string; name: string; email: string; role: Role; mfaPending?: boolean; tenantWritable?: boolean };

export type CampaignAudience = {
  tagIds: string[];
  types: ContactType[];
  leadStatuses: LeadStatus[];
  sources: string[];
  noOrderDays?: number | null;
  paidInFull: boolean;
};
export type AudiencePreview = { total: number; notReachable: number; tooLarge: boolean; max: number; sample: { id: string; name: string }[] };
export type CampaignStatus = "DRAFT" | "QUEUED" | "SENDING" | "PAUSED" | "COMPLETED" | "STOPPED";
export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  audience: CampaignAudience;
  values: string[];
  testedAt: string | null;
  audienceSize: number | null;
  pausedReason: "DAILY_LIMIT" | "META_RATE_LIMIT" | "TOO_MANY_FAILURES" | "TEMPLATE_UNAVAILABLE" | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: Person;
  /** Customers per outcome (PENDING, SENT, DELIVERED, READ, FAILED, SKIPPED); empty for a draft. */
  counts?: Record<string, number>;
};

export type CampaignBatch = {
  busy: boolean;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  status: CampaignStatus;
  pausedReason: Campaign["pausedReason"];
};

export type CampaignReport = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryFailed: number;
  skipped: number;
  waiting: number;
  replies: number;
  optedOut: number;
  reasons: { kind: "failed" | "skipped" | "not delivered"; reason: string; count: number }[];
};
