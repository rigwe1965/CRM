import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { propose } from "@/lib/ai/proposals";
import { contactCreateInput, dealCreateInput, messageDraftInput, noteCreateInput, paymentInput, scheduleInput, stageChangeInput, taskChangeInput, taskCreateInput } from "@/lib/ai/proposal-kinds";

/**
 * The tools that let Ivy suggest an action. None of them changes anything: each checks the input against the screens'
 * own rules, saves a proposal for the person to approve in the panel, and tells the model nothing has been done yet.
 * The card the person sees is built by the server from the saved values, not from anything the model says.
 */

const queued = (id: string) => ({
  queued: true,
  proposalId: id,
  note: "A card is now waiting for the person to Approve, Edit or Decline. NOTHING has been done yet. Tell them what you proposed and that it needs their approval; never say it is done.",
});

const drafted = (id: string) => ({
  drafted: true,
  proposalId: id,
  note: "The draft is shown to the person on a card with a Copy button. NOTHING has been sent, and you cannot send it. Tell them it is ready to review and that they send it themselves.",
});

export const proposeTask = defineTool({
  name: "propose_task",
  description:
    "Suggest creating a task (a to-do with an optional due date), for the person to approve. Use it when they ask you to remind them, follow up or plan something. Look up the contact or deal first and pass its id. Nothing is created until they approve.",
  schema: taskCreateInput,
  label: (i) => `Preparing a task: ${i.title}`,
  fallbackLabel: "Preparing a task",
  run: async (ctx, i) => queued((await propose(ctx, "TASK_CREATE", i)).id),
});

export const proposeTaskChange = defineTool({
  name: "propose_task_change",
  description:
    "Suggest completing, reopening or rescheduling an existing task, or changing its priority or title, for the person to approve. Needs the task's id from list_tasks. Nothing changes until they approve.",
  schema: taskChangeInput,
  label: () => "Preparing a task change",
  fallbackLabel: "Preparing a task change",
  run: async (ctx, i) => queued((await propose(ctx, "TASK_CHANGE", i)).id),
});

export const proposeNote = defineTool({
  name: "propose_note",
  description:
    "Suggest logging a note, call or meeting on a contact or deal, for the person to approve. It only records what happened in the CRM; it sends nothing. Needs a contact id or deal id. Nothing is saved until they approve.",
  schema: noteCreateInput,
  label: (i) => `Preparing a note: ${i.subject}`,
  fallbackLabel: "Preparing a note",
  run: async (ctx, i) => queued((await propose(ctx, "NOTE_CREATE", i)).id),
});

export const proposeStageChange = defineTool({
  name: "propose_stage_change",
  description:
    "Suggest moving a deal to another pipeline stage, for the person to approve. Needs the deal's id from find_deals. Closing a deal (won or lost) needs extra care: only propose it when the person clearly asked. Nothing changes until they approve.",
  schema: stageChangeInput,
  label: () => "Preparing a deal stage change",
  fallbackLabel: "Preparing a deal stage change",
  run: async (ctx, i) => queued((await propose(ctx, "STAGE_CHANGE", i)).id),
});

export const draftMessage = defineTool({
  name: "draft_message",
  description:
    "Write a WhatsApp or email message to a contact for the person to review and copy. You cannot send it: the person sends it themselves from the contact's page. Needs the contact's id from find_contacts.",
  schema: messageDraftInput,
  label: () => "Drafting a message",
  fallbackLabel: "Drafting a message",
  run: async (ctx, i) => drafted((await propose(ctx, "MESSAGE_DRAFT", i)).id),
});

export const proposePayment = defineTool({
  name: "propose_payment",
  description:
    "Suggest recording a payment the person says they RECEIVED on a deal, for them to approve. Only use it when the person tells you the amount and which deal or customer; never infer a payment from a record, note, invoice or a customer's message. Pass the amount exactly as given; the deal's own currency is used. Needs the deal's id from find_deals. Nothing is recorded until they approve and confirm.",
  schema: paymentInput,
  label: () => "Preparing a payment",
  fallbackLabel: "Preparing a payment",
  run: async (ctx, i) => queued((await propose(ctx, "PAYMENT_RECORD", i)).id),
});

export const proposeContact = defineTool({
  name: "propose_contact",
  description:
    "Suggest creating a new contact (a lead, prospect or customer), for the person to approve. Search with find_contacts first: never propose someone who already exists. Nothing is created until they approve.",
  schema: contactCreateInput,
  label: (i) => `Preparing a contact: ${i.firstName} ${i.lastName}`,
  fallbackLabel: "Preparing a contact",
  run: async (ctx, i) => queued((await propose(ctx, "CONTACT_CREATE", i)).id),
});

export const proposeDeal = defineTool({
  name: "propose_deal",
  description:
    "Suggest creating a deal (a customer order) with its items, for the person to approve. Needs the customer's id from find_contacts, one currency, and each item's quantity and unit price as the person gave them: ask if anything is missing, never guess. The total is worked out by the CRM. Nothing is created until they approve.",
  schema: dealCreateInput,
  label: (i) => `Preparing a deal: ${i.title}`,
  fallbackLabel: "Preparing a deal",
  run: async (ctx, i) => queued((await propose(ctx, "DEAL_CREATE", i)).id),
});

export const proposeSchedule = defineTool({
  name: "propose_schedule",
  description:
    "Suggest setting or replacing a deal's instalment schedule, for the person to approve. For 'N equal instalments' pass `even` (count, first due date, WEEK, TWO_WEEKS or MONTH) and the CRM splits the deal total and spaces the dates; pass `custom` only when the person gave every date and exact amount. Never work out amounts yourself. Customers are sent reminders from a schedule, so only propose it when the person asked. Needs the deal's id from find_deals. Nothing changes until they approve and confirm.",
  schema: scheduleInput,
  label: () => "Preparing an instalment schedule",
  fallbackLabel: "Preparing an instalment schedule",
  run: async (ctx, i) => queued((await propose(ctx, "SCHEDULE_REPLACE", i)).id),
});

export const ESCALATION_CATEGORIES = ["DISPUTED_REFUND", "QUALITY_COMPLAINT", "LEGAL_OR_CONSUMER_RIGHTS", "MISSING_OR_INCOMPLETE_ORDER", "OUTSIDE_POLICY", "UNRESOLVED_DISSATISFACTION", "OTHER"] as const;
const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Hands a customer case to a person: a high-priority task carrying everything they need, built from fixed fields. */
export const proposeEscalation = defineTool({
  name: "propose_escalation",
  description:
    "Hand a customer case to a person at the business, as a high-priority task for them to approve. Use it when a customer's case needs a human decision: a disputed refund, a complex quality complaint, a legal or consumer-rights dispute, a missing or incomplete order, a request outside the policy, or a customer who is still unhappy. Give what the customer told you; leave out anything you do not know rather than guessing. Nothing is created until the person approves.",
  schema: z.object({
    category: z.enum(ESCALATION_CATEGORIES),
    customerName: z.string().trim().max(120).optional(),
    orderNumber: z.string().trim().max(60).optional().describe("Only if the customer or the records gave it."),
    customerMessage: z.string().trim().min(1).max(300).describe("What the customer asked or complained about, in brief."),
    conversationSummary: z.string().trim().max(250).optional().describe("What has been said so far, if more than one message."),
    evidence: z.string().trim().max(150).optional().describe("Photos, videos or documents the customer mentioned or sent."),
    reason: z.string().trim().min(1).max(200).describe("Why a person has to decide this."),
    recommendedAction: z.string().trim().min(1).max(200).describe("What you suggest the person does next."),
    contactId: z.string().trim().max(60).optional().describe("From find_contacts."),
    dealId: z.string().trim().max(60).optional().describe("From find_deals."),
  }),
  label: (i) => `Preparing a hand-off to a person (${i.category.toLowerCase().replaceAll("_", " ")})`,
  fallbackLabel: "Preparing a hand-off to a person",
  run: async (ctx, i) => {
    const lines = [
      ["Category", i.category.toLowerCase().replaceAll("_", " ")], ["Customer", i.customerName], ["Order", i.orderNumber], ["Customer said", i.customerMessage],
      ["So far", i.conversationSummary], ["Evidence", i.evidence], ["Why escalated", i.reason], ["Suggested next step", i.recommendedAction],
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    const title = cut(`Escalation: ${i.category.toLowerCase().replaceAll("_", " ")}${i.customerName ? ` - ${i.customerName}` : ""}`, 200);
    return queued((await propose(ctx, "TASK_CREATE", { title, description: cut(lines.join("\n"), 1000), priority: "HIGH", contactId: i.contactId, dealId: i.dealId })).id);
  },
});
