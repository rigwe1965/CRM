import { Prisma } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth-helpers";
import { ownerScope, taskScope } from "@/lib/access";
import { getIntegration } from "@/lib/integrations";
import { accessOf } from "@/lib/plans";
import { paymentSummaries } from "@/lib/payments";
import { anthropicFor } from "@/lib/ai/client";
import { flagForeignContent } from "@/lib/ai/draft-check";
import { IVY_MODEL, tokenUsage } from "@/lib/ai/pricing";
import { FALLBACK_BETA, IVY_EFFORT } from "@/lib/ai/ivy";
import { createBackgroundProposal } from "@/lib/ai/proposals";
import { DEFAULT_TRIAGE_DAILY_CAP, loadAssistantSettings } from "@/lib/ai/settings";
import { ceilingState, monthToDateMicros, recordUsage } from "@/lib/ai/usage";
import { ToolError } from "@/lib/ai/tools/types";
import { clip } from "@/lib/ai/tools/result";
import { TRIAGE_PROMPT, TRIAGE_TOOL, triageResultInput, type TriageResult } from "@/lib/ai/triage/prompt";
import { searchKnowledge } from "@/lib/ai/knowledge/search";
import { asksToStop } from "@/lib/ai/triage/rules";

/**
 * Triage of incoming WhatsApp messages (AI_ASSISTANT_PLAN.md, Phase 3c). The webhook files the message exactly as before
 * and then queues it here (`enqueueTriage`, one `AiTriage` row per message, unique per message so a retry from Meta never
 * queues it twice). After the webhook has answered, `processTriage` makes cards for the contact's owner: a draft reply,
 * and optionally a task or a note. A rule, not the model, spots a request to stop. The model gets the last few messages
 * of that one thread and a fact sheet about that one customer, has no tool that reads or changes anything, and its output
 * goes through the same `prepare` checks and person's approval as every other card. If anything here fails the owner
 * still has the existing "Reply to WhatsApp" task. Run inside the business's context.
 */

/** At most this many model calls for one customer in an hour: a stranger or a loop cannot burn the budget by texting. */
export const TRIAGE_PER_CONTACT_PER_HOUR = 3;
export const TRIAGE_MAX_ATTEMPTS = 3;
const STALE_RUN_MS = 10 * 60_000;
const HOUR = 3_600_000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const LABEL_TEXT: Record<TriageResult["label"], string> = {
  PAYMENT_CLAIM: "Payment claim",
  ORDER_ENQUIRY: "Order enquiry",
  DELIVERY_QUESTION: "Delivery question",
  COMPLAINT: "Complaint",
  WANTS_TO_STOP: "Wants to stop",
  OTHER: "Message",
};

type Skip = "switched_off" | "customer_gone" | "no_owner" | "read_only" | "new_number" | "contact_limit" | "daily_cap" | "ceiling" | "no_key" | "already_opted_out";

/** Queues the messages the webhook just filed, if triage is on. Returns the ids of the messages to process. Cheap, and safe to call twice. */
export async function enqueueTriage(tenantId: string, messageIds: string[]): Promise<string[]> {
  if (messageIds.length === 0) return [];
  const settings = await loadAssistantSettings(tenantId);
  if (!settings.enabled || settings.triageEnabled !== true) return [];
  const out: string[] = [];
  for (const externalId of messageIds) {
    const activity = await db.activity.findFirst({ where: { tenantId, externalId, type: "WHATSAPP", direction: "IN" }, select: { id: true, contactId: true } });
    if (!activity?.contactId) continue;
    try {
      await db.aiTriage.create({ data: { tenantId, activityId: activity.id, contactId: activity.contactId } });
      out.push(activity.id);
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already queued
    }
  }
  return out;
}

/** Works through queued messages one at a time. Never throws: a failure is recorded on the message and retried later. */
export async function processTriage(tenantId: string, activityIds: string[], opts: { now?: Date; client?: Pick<Anthropic, "beta"> | null } = {}) {
  for (const activityId of activityIds) {
    try {
      await triageOne(tenantId, activityId, opts);
    } catch (e) {
      console.error("[ivy-triage] failed", e instanceof Error ? e.message : e);
      await db.aiTriage.updateMany({ where: { tenantId, activityId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date() } }).catch(() => undefined);
    }
  }
}

/** The daily job: finishes messages that were queued but never processed (a crash, a failed model call). Gives up after a few tries or a day. */
export async function retryPendingTriage(tenantId: string, now = new Date()) {
  const rows = await db.aiTriage.findMany({
    where: {
      tenantId,
      attempts: { lt: TRIAGE_MAX_ATTEMPTS },
      createdAt: { gte: new Date(now.getTime() - 24 * HOUR) },
      OR: [{ status: "PENDING", createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, { status: "FAILED" }, { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } }],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { activityId: true },
  });
  await processTriage(tenantId, rows.map((r) => r.activityId), { now });
  return rows.length;
}

async function skip(tenantId: string, activityId: string, reason: Skip) {
  await db.aiTriage.updateMany({ where: { tenantId, activityId }, data: { status: "SKIPPED", skipReason: reason, finishedAt: new Date() } });
}

async function triageOne(tenantId: string, activityId: string, opts: { now?: Date; client?: Pick<Anthropic, "beta"> | null }) {
  const now = opts.now ?? new Date();

  // Claim it: only a message nobody is working on, and not given up on.
  const claimed = await db.aiTriage.updateMany({
    where: {
      tenantId,
      activityId,
      attempts: { lt: TRIAGE_MAX_ATTEMPTS },
      OR: [{ status: "PENDING" }, { status: "FAILED" }, { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } }],
    },
    data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: now, finishedAt: null },
  });
  if (claimed.count !== 1) return;

  const settings = await loadAssistantSettings(tenantId);
  if (!settings.enabled || settings.triageEnabled !== true) return skip(tenantId, activityId, "switched_off");

  const activity = await db.activity.findFirst({ where: { id: activityId, tenantId }, select: { body: true, contactId: true, occurredAt: true } });
  const contact = activity?.contactId
    ? await db.contact.findFirst({
        where: { id: activity.contactId, tenantId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, phoneE164: true, whatsappOptIn: true, ownerId: true, source: true },
      })
    : null;
  if (!activity || !contact) return skip(tenantId, activityId, "customer_gone");
  const text = activity.body ?? "";

  const owner = contact.ownerId ? await db.user.findFirst({ where: { id: contact.ownerId, tenantId, isActive: true }, select: { id: true, name: true, email: true, role: true } }) : null;
  if (!owner) return skip(tenantId, activityId, "no_owner");
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { status: true, plan: true, billingStatus: true, trialEndsAt: true, currentPeriodEnd: true, deletionRequestedAt: true } });
  if (tenant && !accessOf(tenant, now).writable) return skip(tenantId, activityId, "read_only");
  const user = { id: owner.id, tenantId, role: owner.role, name: owner.name, email: owner.email, tenantWritable: true } as unknown as SessionUser;

  const made = { cards: 0 };
  const card = async (input: Omit<Parameters<typeof createBackgroundProposal>[1], "source" | "subject" | "now">) => {
    try {
      if (await createBackgroundProposal(user, { ...input, source: "WHATSAPP", subject: { type: "contact", id: contact.id }, now })) made.cards++;
    } catch (e) {
      if (!(e instanceof ToolError)) throw e; // the record changed since: skip this card, keep the rest
    }
  };
  const theyWrote = [{ label: "They wrote", value: clip(text, 300) ?? "" }];
  const optOutCard = () =>
    card({ kind: "CONTACT_OPT_OUT", dedupeKey: `wa:${activityId}:optout`, raw: { contactId: contact.id }, reason: "Their WhatsApp message asks us to stop messaging them.", extraLines: theyWrote });

  // A clear request to stop is found by a rule, with no model, whoever wrote it and however busy the day.
  if (asksToStop(text)) {
    if (!contact.whatsappOptIn) return skip(tenantId, activityId, "already_opted_out");
    await optOutCard();
    await db.aiTriage.updateMany({ where: { tenantId, activityId }, data: { status: "DONE", label: "WANTS_TO_STOP", urgency: "HIGH", skipReason: "rule", cards: made.cards, finishedAt: new Date() } });
    return;
  }

  // A number we have never answered gets no model call: a stranger cannot spend the budget by texting. (The owner still has the reply task.)
  if (contact.source === "WhatsApp") {
    const replied = await db.activity.count({ where: { tenantId, contactId: contact.id, type: "WHATSAPP", direction: "OUT" } });
    if (replied === 0) return skip(tenantId, activityId, "new_number");
  }

  const [lastHour, today] = await Promise.all([
    db.aiTriage.count({ where: { tenantId, contactId: contact.id, modelCalled: true, createdAt: { gte: new Date(now.getTime() - HOUR) } } }),
    db.aiTriage.count({ where: { tenantId, modelCalled: true, createdAt: { gte: startOfDay(now) } } }),
  ]);
  if (lastHour >= TRIAGE_PER_CONTACT_PER_HOUR) return skip(tenantId, activityId, "contact_limit");
  if (today >= (settings.triageDailyCap ?? DEFAULT_TRIAGE_DAILY_CAP)) return skip(tenantId, activityId, "daily_cap");
  const level = ceilingState(settings.monthlyCeilingUsd, await monthToDateMicros(tenantId, now)).level;
  if (level === "reached" || level === "unset") return skip(tenantId, activityId, "ceiling");
  if (opts.client === null || (!opts.client && !(await getIntegration(tenantId, "ANTHROPIC")))) return skip(tenantId, activityId, "no_key");
  const client = opts.client ?? (await anthropicFor(tenantId));

  // Counted from here, even if the call fails: a failing call still costs, and must not be retried without limit.
  await db.aiTriage.updateMany({ where: { tenantId, activityId }, data: { modelCalled: true } });

  const sheet = await factSheet(user, contact, activityId);
  // The customer's recent words pick the policy entries the model gets to read; the model never searches by itself.
  const policy = (await searchKnowledge(tenantId, sheet.thread.filter((m) => m.from === "customer").slice(-3).map((m) => m.text).join(" "), 5)).results;
  const message = await client.beta.messages.create(triageRequest(sheet, policy), { timeout: 40_000 });
  const cost = await recordUsage({ tenantId, userId: owner.id, model: message.model, usage: tokenUsage(message.usage), purpose: "TRIAGE" });
  const use = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TRIAGE_TOOL.name);
  const parsed = use ? triageResultInput.safeParse(use.input) : null;
  if (!parsed?.success || message.stop_reason === "max_tokens") {
    await db.aiTriage.updateMany({ where: { tenantId, activityId }, data: { status: "FAILED", costMicros: cost, finishedAt: new Date() } });
    return;
  }
  const r = parsed.data;

  const reason = `${LABEL_TEXT[r.label]}: ${r.summary}`;
  if (r.label === "WANTS_TO_STOP" && contact.whatsappOptIn) await optOutCard();
  if (r.reply && r.label !== "WANTS_TO_STOP") {
    await card({
      kind: "MESSAGE_DRAFT",
      dedupeKey: `wa:${activityId}:msg`,
      raw: { contactId: contact.id, channel: "WHATSAPP", message: r.reply },
      reason,
      extraLines: theyWrote,
      extraWarning: flagForeignContent(r.reply, [contact.email, contact.phoneE164]) ?? undefined,
    });
  }
  if (r.task) {
    await card({ kind: "TASK_CREATE", dedupeKey: `wa:${activityId}:task`, raw: { title: r.task.title, priority: r.task.priority, dueDate: isoDay(now), contactId: contact.id }, reason, extraLines: r.reply ? undefined : theyWrote });
  }
  if (r.escalation) {
    const e = r.escalation;
    const label = e.category.toLowerCase().replaceAll("_", " ");
    const lines = [["Category", label], ["Customer", `${contact.firstName} ${contact.lastName}`.trim()], ["Order", e.orderNumber], ["Customer said", clip(text, 300)], ["Summary", r.summary], ["Evidence", e.evidence], ["Why escalated", e.reason], ["Suggested next step", e.recommendedAction]]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`);
    await card({ kind: "TASK_CREATE", dedupeKey: `wa:${activityId}:escalation`, raw: { title: `Escalation: ${label} - ${contact.firstName}`.slice(0, 200), description: lines.join("\n").slice(0, 1000), priority: "HIGH", dueDate: isoDay(now), contactId: contact.id }, reason, extraLines: r.reply ? undefined : theyWrote });
  }
  if (r.note) {
    await card({ kind: "NOTE_CREATE", dedupeKey: `wa:${activityId}:note`, raw: { subject: r.note.subject, body: r.note.body, type: "NOTE", contactId: contact.id }, reason, extraLines: r.reply || r.task ? undefined : theyWrote });
  }

  await db.aiTriage.updateMany({
    where: { tenantId, activityId },
    data: { status: "DONE", label: r.label, urgency: r.urgency, summary: r.summary, cards: made.cards, costMicros: cost, finishedAt: new Date() },
  });
}

/** The one request triage makes. Exported so the quality check (scripts/triage-eval.ts) sends exactly what the app sends. */
export function triageRequest(sheet: { customer: unknown; thread: unknown }, policy: readonly { title: string; basis: string; body: string }[] = []) {
  return {
    model: IVY_MODEL,
    max_tokens: 2000,
    system: TRIAGE_PROMPT,
    tools: [TRIAGE_TOOL] as unknown as Anthropic.Beta.BetaToolUnion[],
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: `<customer>\n${JSON.stringify(sheet.customer)}\n</customer>\n<thread>\n${JSON.stringify(sheet.thread)}\n</thread>
<policy_excerpts>
${JSON.stringify(policy.map((p) => ({ title: p.title, basis: p.basis, text: p.body })))}
</policy_excerpts>` }] }],
    output_config: { effort: IVY_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
  };
}

/** What the model sees: this thread's last five messages, and a short sheet about this one customer from the owner's own view of the records. */
async function factSheet(owner: SessionUser, contact: { id: string; firstName: string; lastName: string }, activityId: string) {
  const [recent, deals, tasks] = await Promise.all([
    db.activity.findMany({
      where: { tenantId: owner.tenantId, contactId: contact.id, type: "WHATSAPP" },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, direction: true, body: true, occurredAt: true },
    }),
    db.deal.findMany({
      where: { AND: [{ deletedAt: null }, ownerScope(owner), { contactId: contact.id }] },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, title: true, stage: true, amount: true, currency: true },
    }),
    db.task.findMany({ where: { AND: [taskScope(owner), { contactId: contact.id }, { status: { in: ["TODO", "IN_PROGRESS"] } }] }, orderBy: { dueDate: "asc" }, take: 5, select: { title: true, dueDate: true } }),
  ]);
  const sums = await paymentSummaries(deals);
  // The newest message must be in the thread even if five newer ones somehow exist.
  const thread = recent.reverse().map((m) => ({ from: m.direction === "IN" ? "customer" : "us", at: m.occurredAt.toISOString(), text: clip(m.body, 600) ?? "", latest: m.id === activityId }));
  return {
    thread,
    customer: {
      firstName: contact.firstName,
      deals: deals.map((d) => {
        const s = sums.get(d.id);
        return { title: clip(d.title, 80), stage: d.stage, total: `${Number(d.amount).toFixed(2)} ${d.currency}`, paid: s ? s.paid.toFixed(2) : null, owed: s ? s.balance.toFixed(2) : null, overdue: !!s?.overdue };
      }),
      openTasks: tasks.map((t) => ({ title: clip(t.title, 80), due: t.dueDate ? isoDay(t.dueDate) : null })),
    },
  };
}
