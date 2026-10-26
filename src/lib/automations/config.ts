import { z } from "zod";

// No server imports here: the admin screen and the API share these shapes.

export const STAGE_ORDER = ["QUALIFICATION", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"] as const;
export type StageKey = (typeof STAGE_ORDER)[number];

/** The names the team sees on the pipeline (src/lib/client/constants.ts). */
export const STAGE_LABEL: Record<StageKey, string> = {
  QUALIFICATION: "Inquiry",
  DISCOVERY: "Quote Sent",
  PROPOSAL: "Order Confirmed",
  NEGOTIATION: "Deposit Paid",
  CLOSED_WON: "Completed",
  CLOSED_LOST: "Lost",
};

const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

const stageRuleSchema = z.object({
  enabled: z.boolean(),
  /** May use {deal}, {customer} and {stage}. Empty = no task for this stage. */
  title: z.string().trim().max(150),
  dueInDays: z.number().int().min(0).max(60),
  priority,
});
export type StageRule = z.infer<typeof stageRuleSchema>;

export const stageTasksSchema = z.object({
  enabled: z.boolean(),
  stages: z.record(z.enum(STAGE_ORDER), stageRuleSchema),
});
export type StageTasksConfig = z.infer<typeof stageTasksSchema>;

export const quietLeadsSchema = z.object({
  enabled: z.boolean(),
  /** A lead with nothing logged for this many days gets a follow-up task. */
  days: z.number().int().min(1).max(90),
});
export type QuietLeadsConfig = z.infer<typeof quietLeadsSchema>;

/** Your own subject and message for one notice. Blank means the built-in wording. */
export const reminderWordingSchema = z.object({
  subject: z.string().trim().max(150, "Keep the subject under 150 characters"),
  message: z.string().trim().max(2000, "Keep the message under 2000 characters"),
});
export type ReminderWording = z.infer<typeof reminderWordingSchema>;
const BLANK_WORDING: ReminderWording = { subject: "", message: "" };
export const DEFAULT_WORDING = { UPCOMING: BLANK_WORDING, OVERDUE_1: BLANK_WORDING, OVERDUE_2: BLANK_WORDING };

const templateName = z.string().trim().regex(/^[a-z0-9_]{1,200}$/, "Use lowercase letters, numbers and underscores, as in Meta");

/** Payment reminders over WhatsApp. They use message templates approved by Meta, named here. */
export const whatsappRemindersSchema = z.object({
  enabled: z.boolean(),
  /** Meta's language code for the templates, such as en or en_GB. */
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a code such as en or en_GB"),
  /** Test mode sends to this number instead of the customer (international form, +49...). */
  testPhone: z.union([z.literal(""), z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use the international form, such as +2348012345678")]),
  templates: z.object({ UPCOMING: templateName, OVERDUE_1: templateName, OVERDUE_2: templateName }),
});
export type WhatsappRemindersConfig = z.infer<typeof whatsappRemindersSchema>;
export const DEFAULT_WHATSAPP_REMINDERS: WhatsappRemindersConfig = {
  enabled: false,
  language: "en",
  testPhone: "",
  templates: { UPCOMING: "payment_reminder_upcoming", OVERDUE_1: "payment_reminder_overdue", OVERDUE_2: "payment_reminder_final" },
};

export const instalmentEmailsSchema = z
  .object({
    enabled: z.boolean(),
    /** TEST sends every email to `testEmail` instead of the customer. LIVE sends to customers. */
    mode: z.enum(["TEST", "LIVE"]),
    testEmail: z.union([z.literal(""), z.email("Enter a valid email address")]),
    /** Shown to the customer as the sender name and signature. */
    brandName: z.string().trim().min(1, "Required").max(60),
    /** A reminder goes out this many days before the due date (0 = on the day). */
    daysBefore: z.number().int().min(0).max(14),
    /** First and second overdue notice, in days after the due date. */
    firstOverdueDays: z.number().int().min(1).max(30),
    secondOverdueDays: z.number().int().min(2).max(60),
    /** Optional custom wording per notice. A saved setting without it keeps the built-in wording. */
    wording: z
      .object({ UPCOMING: reminderWordingSchema.default(BLANK_WORDING), OVERDUE_1: reminderWordingSchema.default(BLANK_WORDING), OVERDUE_2: reminderWordingSchema.default(BLANK_WORDING) })
      .default(DEFAULT_WORDING),
    /** WhatsApp copies of the same notices, to customers who opted in. A saved setting without it stays off. */
    whatsapp: whatsappRemindersSchema.default(DEFAULT_WHATSAPP_REMINDERS),
  })
  .superRefine((v, ctx) => {
    if (v.secondOverdueDays <= v.firstOverdueDays) {
      ctx.addIssue({ code: "custom", path: ["secondOverdueDays"], message: "Must be later than the first overdue notice" });
    }
    if (v.enabled && v.mode === "TEST" && v.testEmail === "") {
      ctx.addIssue({ code: "custom", path: ["testEmail"], message: "Enter the address that should receive the test emails" });
    }
    if (v.whatsapp.enabled && v.mode === "TEST" && v.whatsapp.testPhone === "") {
      ctx.addIssue({ code: "custom", path: ["whatsapp", "testPhone"], message: "Enter the WhatsApp number that should receive the test messages" });
    }
  });
export type InstalmentEmailsConfig = z.infer<typeof instalmentEmailsSchema>;

export const lowStockSchema = z.object({
  enabled: z.boolean(),
  /** A stock row is low at or below this many pieces unless it has its own level. 0 = no default level. */
  defaultThreshold: z.number().int().min(0).max(100_000),
});
export type LowStockConfig = z.infer<typeof lowStockSchema>;

/** Body of POST /api/admin/automations/sample-email: which sample, to whom, signed as whom. */
export const sampleEmailSchema = z.object({
  to: z.email("Enter a valid email address"),
  brandName: z.string().trim().min(1, "Required").max(60),
  kind: z.enum(["UPCOMING", "OVERDUE_1", "OVERDUE_2"]),
  /** The wording being tried, so an unsaved edit can be checked. Omitted = the built-in wording. */
  wording: reminderWordingSchema.optional(),
});

/** Body of PUT /api/admin/automations: send any of them. */
export const automationsUpdateSchema = z
  .object({ stageTasks: stageTasksSchema, quietLeads: quietLeadsSchema, instalmentEmails: instalmentEmailsSchema, lowStock: lowStockSchema })
  .partial()
  .refine(
    (v) => v.stageTasks !== undefined || v.quietLeads !== undefined || v.instalmentEmails !== undefined || v.lowStock !== undefined,
    "Provide at least one automation to update",
  );

const blank: StageRule = { enabled: false, title: "", dueInDays: 1, priority: "MEDIUM" };

/** Everything ships switched off: an admin turns each automation on in Settings → Automations. */
export const DEFAULT_STAGE_TASKS: StageTasksConfig = {
  enabled: false,
  stages: {
    QUALIFICATION: { ...blank },
    DISCOVERY: { ...blank },
    PROPOSAL: { enabled: true, title: "Send payment details to {customer}", dueInDays: 1, priority: "MEDIUM" },
    NEGOTIATION: { enabled: true, title: "Place the supplier order for {deal}", dueInDays: 2, priority: "HIGH" },
    CLOSED_WON: { enabled: true, title: "Send tracking and ask {customer} for feedback", dueInDays: 1, priority: "MEDIUM" },
    CLOSED_LOST: { ...blank },
  },
};
export const DEFAULT_QUIET_LEADS: QuietLeadsConfig = { enabled: false, days: 7 };
export const DEFAULT_LOW_STOCK: LowStockConfig = { enabled: false, defaultThreshold: 3 };
/** Off, and in test mode: the first emails an admin sees are copies sent to themselves. */
export const DEFAULT_INSTALMENT_EMAILS: InstalmentEmailsConfig = {
  enabled: false,
  mode: "TEST",
  testEmail: "",
  brandName: "Ivycandy Hair",
  daysBefore: 2,
  firstOverdueDays: 1,
  secondOverdueDays: 7,
  wording: DEFAULT_WORDING,
  whatsapp: DEFAULT_WHATSAPP_REMINDERS,
};

/** Saved settings laid over the defaults; anything missing or invalid falls back to the defaults. */
export function resolveStageTasks(stored: unknown): StageTasksConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<StageTasksConfig>;
  const merged = {
    enabled: s.enabled ?? DEFAULT_STAGE_TASKS.enabled,
    stages: Object.fromEntries(
      STAGE_ORDER.map((k) => [k, { ...DEFAULT_STAGE_TASKS.stages[k], ...(s.stages?.[k] ?? {}) }]),
    ),
  };
  const parsed = stageTasksSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_STAGE_TASKS;
}

export function resolveQuietLeads(stored: unknown): QuietLeadsConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<QuietLeadsConfig>;
  const parsed = quietLeadsSchema.safeParse({ ...DEFAULT_QUIET_LEADS, ...s });
  return parsed.success ? parsed.data : DEFAULT_QUIET_LEADS;
}

export function resolveLowStock(stored: unknown): LowStockConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<LowStockConfig>;
  const parsed = lowStockSchema.safeParse({ ...DEFAULT_LOW_STOCK, ...s });
  return parsed.success ? parsed.data : DEFAULT_LOW_STOCK;
}

export function resolveInstalmentEmails(stored: unknown, businessBrand?: string): InstalmentEmailsConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<InstalmentEmailsConfig>;
  // A business that never chose a brand name is named after itself, never after the original business.
  const defaults = { ...DEFAULT_INSTALMENT_EMAILS, ...(businessBrand && { brandName: businessBrand.slice(0, 60) }) };
  const parsed = instalmentEmailsSchema.safeParse({ ...defaults, ...s });
  return parsed.success ? parsed.data : defaults;
}

/** Fills {deal}, {customer} and {stage}; unknown {words} are left as written. Capped to the task title limit. */
export function renderTitle(template: string, vars: { deal: string; customer: string; stage: string }): string {
  return template
    .replace(/\{(deal|customer|stage)\}/g, (_m, k: keyof typeof vars) => vars[k])
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
