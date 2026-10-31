import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, settings, proposals, integ, usage, record, pay, clientFor } = vi.hoisted(() => ({
  db: {
    aiTriage: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    activity: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    contact: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
    deal: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    knowledgeEntry: { findMany: vi.fn() },
  },
  settings: vi.fn(),
  proposals: { createBackgroundProposal: vi.fn() },
  integ: vi.fn(),
  usage: vi.fn(),
  record: vi.fn(),
  pay: { paymentSummaries: vi.fn() },
  clientFor: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/settings")>()), loadAssistantSettings: settings }));
vi.mock("@/lib/ai/proposals", () => proposals);
vi.mock("@/lib/integrations", () => ({ getIntegration: integ }));
vi.mock("@/lib/ai/client", () => ({ anthropicFor: clientFor }));
vi.mock("@/lib/ai/usage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/usage")>()), monthToDateMicros: usage, recordUsage: record }));
vi.mock("@/lib/payments", () => pay);

import { Prisma } from "@prisma/client";
import { ToolError } from "@/lib/ai/tools/types";
import { enqueueTriage, processTriage, retryPendingTriage, TRIAGE_PER_CONTACT_PER_HOUR } from "@/lib/ai/triage/run";

const NOW = new Date("2026-11-04T10:00:00Z");
const T = "t1";
const dup = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
const on = { enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, triageEnabled: true };

const contact = (over: Record<string, unknown> = {}) => ({ id: "c1", firstName: "Adaeze", lastName: "Okafor", email: "ada@x.test", phoneE164: "+2348011111111", whatsappOptIn: true, ownerId: "u-sales", source: "Referral", ...over });
const verdict = (over: Record<string, unknown> = {}) => ({ label: "PAYMENT_CLAIM", urgency: "HIGH", summary: "Says they paid 300 USD.", reply: "Thank you Adaeze, we will check and confirm shortly.", task: { title: "Check whether the 300 USD payment arrived", priority: "HIGH" }, ...over });
const modelSays = (input: unknown, extra: Record<string, unknown> = {}) =>
  vi.fn().mockResolvedValue({ model: "claude-sonnet-5-5", stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "tool_use", name: "triage_result", id: "x", input }], ...extra });
const clientWith = (create: ReturnType<typeof vi.fn>) => ({ beta: { messages: { create } } }) as never;

let text = "Hello, I have sent the 300 USD today";
beforeEach(() => {
  vi.resetAllMocks();
  text = "Hello, I have sent the 300 USD today";
  settings.mockResolvedValue(on);
  db.aiTriage.updateMany.mockResolvedValue({ count: 1 });
  db.aiTriage.count.mockResolvedValue(0);
  db.activity.findFirst.mockImplementation(async () => ({ body: text, contactId: "c1", occurredAt: NOW }));
  db.activity.findMany.mockResolvedValue([{ id: "a1", direction: "IN", body: text, occurredAt: NOW }]);
  db.activity.count.mockResolvedValue(2);
  db.contact.findFirst.mockResolvedValue(contact());
  db.user.findFirst.mockResolvedValue({ id: "u-sales", name: "Sam", email: "sam@x.test", role: "SALES" });
  db.tenant.findFirst.mockResolvedValue(null);
  db.deal.findMany.mockResolvedValue([{ id: "d1", title: "Wholesale", stage: "CLOSED_WON", amount: "300", currency: "USD" }]);
  db.task.findMany.mockResolvedValue([]);
  db.knowledgeEntry.findMany.mockResolvedValue([]);
  pay.paymentSummaries.mockResolvedValue(new Map([["d1", { paid: 0, balance: 300, overdue: false }]]));
  proposals.createBackgroundProposal.mockResolvedValue({ id: "p" });
  integ.mockResolvedValue({ settings: { apiKey: "k" } });
  usage.mockResolvedValue(0);
  record.mockResolvedValue(15_000);
});

const lastUpdate = () => db.aiTriage.updateMany.mock.calls.at(-1)![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
const cardsMade = () => proposals.createBackgroundProposal.mock.calls.map((c) => c[1] as { kind: string; dedupeKey: string; source: string; raw: Record<string, unknown>; reason: string; extraLines?: { label: string; value: string }[]; extraWarning?: string; subject: { type: string; id: string } });

describe("enqueueTriage", () => {
  it("queues nothing, and reads nothing, when triage or Ivy is off", async () => {
    settings.mockResolvedValue({ ...on, triageEnabled: undefined });
    expect(await enqueueTriage(T, ["m1"])).toEqual([]);
    settings.mockResolvedValue({ ...on, enabled: false });
    expect(await enqueueTriage(T, ["m1"])).toEqual([]);
    expect(db.aiTriage.create).not.toHaveBeenCalled();
    expect(db.activity.findFirst).not.toHaveBeenCalled();
  });

  it("queues each incoming message once, for this business, and skips one that is already queued (a retry from Meta)", async () => {
    db.activity.findFirst.mockResolvedValueOnce({ id: "a1", contactId: "c1" }).mockResolvedValueOnce({ id: "a2", contactId: "c1" });
    db.aiTriage.create.mockResolvedValueOnce({}).mockRejectedValueOnce(dup());
    expect(await enqueueTriage(T, ["m1", "m2"])).toEqual(["a1"]);
    expect(db.aiTriage.create.mock.calls[0][0].data).toEqual({ tenantId: T, activityId: "a1", contactId: "c1" });
    expect(db.activity.findFirst.mock.calls[0][0].where).toEqual({ tenantId: T, externalId: "m1", type: "WHATSAPP", direction: "IN" });
  });
});

describe("processTriage: a message that is worth the model", () => {
  it("makes a draft, a task, with the verdict as the reason, for the contact's owner, as WhatsApp suggestions", async () => {
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    const cards = cardsMade();
    expect(cards.map((c) => c.kind)).toEqual(["MESSAGE_DRAFT", "TASK_CREATE"]);
    expect(cards.every((c) => c.source === "WHATSAPP" && c.subject.id === "c1")).toBe(true);
    expect(cards[0]).toMatchObject({ dedupeKey: "wa:a1:msg", raw: { contactId: "c1", channel: "WHATSAPP", message: "Thank you Adaeze, we will check and confirm shortly." }, reason: "Payment claim: Says they paid 300 USD." });
    expect(cards[0].extraLines).toEqual([{ label: "They wrote", value: "Hello, I have sent the 300 USD today" }]);
    expect(cards[0].extraWarning).toBeUndefined();
    expect(cards[1]).toMatchObject({ dedupeKey: "wa:a1:task", raw: { title: "Check whether the 300 USD payment arrived", priority: "HIGH", dueDate: "2026-11-04", contactId: "c1" } });
    // the cards are made as the owner, not as anyone else
    expect(proposals.createBackgroundProposal.mock.calls[0][0]).toMatchObject({ id: "u-sales", tenantId: T, role: "SALES" });
    expect(lastUpdate().data).toMatchObject({ status: "DONE", label: "PAYMENT_CLAIM", urgency: "HIGH", summary: "Says they paid 300 USD.", cards: 2, costMicros: 15_000 });
    expect(record.mock.calls[0][0]).toMatchObject({ tenantId: T, userId: "u-sales", purpose: "TRIAGE" });
  });

  it("sends the policy entries that match what the customer wrote, scoped to this business, as data", async () => {
    text = "My wig arrived damaged, can I get a refund?";
    db.activity.findMany.mockResolvedValue([{ id: "a1", direction: "IN", body: text, occurredAt: NOW }]);
    db.knowledgeEntry.findMany.mockResolvedValue([
      { key: "damaged-defective", category: "DAMAGED", title: "Damaged and defective products", body: "Damaged products are investigated.", basis: "STATUTORY", keywords: ["damaged"], version: 1, updatedAt: NOW },
      { key: "support-hours", category: "SUPPORT", title: "Hours", body: "Open Monday to Friday.", basis: "INFO", keywords: ["hours"], version: 1, updatedAt: NOW },
    ]);
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(db.knowledgeEntry.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, status: "ACTIVE" });
    const sent = (create.mock.calls[0][0] as { messages: { content: { text: string }[] }[] }).messages[0].content[0].text;
    expect(sent).toContain("<policy_excerpts>");
    expect(sent).toContain("Damaged products are investigated.");
    expect(sent).not.toContain("Open Monday to Friday.");
  });

  it("turns an escalation into one high-priority task that carries the case details", async () => {
    text = "Order IC-1042 is wrong and I want my money back, I will go to a lawyer";
    const create = modelSays(verdict({ label: "COMPLAINT", reply: undefined, task: undefined, escalation: { category: "LEGAL_OR_CONSUMER_RIGHTS", orderNumber: "IC-1042", reason: "Customer mentions a lawyer", recommendedAction: "Call the customer today" } }));
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    const cards = cardsMade();
    expect(cards.map((c) => c.kind)).toEqual(["TASK_CREATE"]);
    expect(cards[0]).toMatchObject({ dedupeKey: "wa:a1:escalation", raw: { priority: "HIGH", contactId: "c1" } });
    expect(String(cards[0].raw.title)).toContain("legal or consumer rights");
    expect(String(cards[0].raw.description)).toContain("Order: IC-1042");
    expect(String(cards[0].raw.description)).toContain("Why escalated: Customer mentions a lawyer");
  });

  it("only ever offers the model one verdict tool, and sends it this thread and this customer, nothing else", async () => {
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    const req = create.mock.calls[0][0] as { tools: { name: string }[]; messages: { content: { text: string }[] }[] };
    expect(req.tools.map((t) => t.name)).toEqual(["triage_result"]);
    const sent = req.messages[0].content[0].text;
    expect(sent).toContain("Adaeze");
    expect(sent).not.toContain("ada@x.test");
    expect(sent).not.toContain("+2348011111111");
    expect(sent).toContain('"title":"Wholesale"');
    // the thread is this contact's, in this business, five at most
    const q = db.activity.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ tenantId: T, contactId: "c1", type: "WHATSAPP" });
    expect(q.take).toBe(5);
    // the deals and tasks are read through the owner's own view
    expect(JSON.stringify(db.deal.findMany.mock.calls[0][0].where)).toContain('"ownerId":"u-sales"');
    expect(JSON.stringify(db.task.findMany.mock.calls[0][0].where)).toContain("u-sales");
  });

  it("flags a draft with a link or account number that is not in the customer's record, but still shows it to the person", async () => {
    const create = modelSays(verdict({ reply: "Please pay to account 0123456789 or https://pay.evil.example/x" }));
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(cardsMade()[0].extraWarning).toMatch(/link.*that is not from your records/);
  });

  it("a payment claim can only become a draft, a task or a note: never a payment, whatever the model returns", async () => {
    const create = modelSays({ ...verdict(), recordPayment: { dealId: "d1", amount: 300 }, kind: "PAYMENT_RECORD" });
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(cardsMade().every((c) => ["MESSAGE_DRAFT", "TASK_CREATE", "NOTE_CREATE"].includes(c.kind))).toBe(true);
  });

  it("makes a note card when the model asks for one, quoting the message when nothing else does", async () => {
    const create = modelSays(verdict({ reply: undefined, task: undefined, label: "OTHER", urgency: "LOW", note: { subject: "Asked about lace colours", body: "Prefers natural black." } }));
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    const [note] = cardsMade();
    expect(note).toMatchObject({ kind: "NOTE_CREATE", dedupeKey: "wa:a1:note", raw: { subject: "Asked about lace colours", body: "Prefers natural black.", type: "NOTE", contactId: "c1" } });
    expect(note.extraLines).toHaveLength(1);
  });

  it("makes no card for a message that needs nothing, and still records the verdict", async () => {
    const create = modelSays({ label: "OTHER", urgency: "LOW", summary: "Says thanks." });
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(proposals.createBackgroundProposal).not.toHaveBeenCalled();
    expect(lastUpdate().data).toMatchObject({ status: "DONE", label: "OTHER", cards: 0 });
  });

  it("when the model itself says the customer wants to stop, offers the opt-out and writes no reply", async () => {
    text = "I am not interested any more, thanks";
    const create = modelSays(verdict({ label: "WANTS_TO_STOP", urgency: "NORMAL", task: undefined }));
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(cardsMade().map((c) => c.kind)).toEqual(["CONTACT_OPT_OUT"]);
  });

  it("skips a card whose record changed, and keeps the others", async () => {
    proposals.createBackgroundProposal.mockRejectedValueOnce(new ToolError("No contact")).mockResolvedValue({ id: "p" });
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(modelSays(verdict())) });
    expect(lastUpdate().data).toMatchObject({ status: "DONE", cards: 1 });
  });

  it("marks the message failed, to be retried, when the model's answer is unusable or cut off, and still counts the cost", async () => {
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(modelSays({ label: "RECORD_PAYMENT", urgency: "HIGH", summary: "x" })) });
    expect(lastUpdate().data).toMatchObject({ status: "FAILED", costMicros: 15_000 });
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(modelSays(verdict(), { stop_reason: "max_tokens" })) });
    expect(lastUpdate().data.status).toBe("FAILED");
    expect(proposals.createBackgroundProposal).not.toHaveBeenCalled();
  });

  it("never throws: a model that errors leaves the message failed, for the daily retry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const create = vi.fn().mockRejectedValue(new Error("overloaded: secret-detail"));
    await expect(processTriage(T, ["a1"], { now: NOW, client: clientWith(create) })).resolves.toBeUndefined();
    expect(db.aiTriage.updateMany.mock.calls.at(-1)![0]).toMatchObject({ where: { tenantId: T, activityId: "a1", status: "RUNNING" }, data: { status: "FAILED" } });
    spy.mockRestore();
  });
});

describe("processTriage: the claim", () => {
  it("claims a message through one conditional update, and does nothing if somebody else has it or it has been tried enough", async () => {
    db.aiTriage.updateMany.mockResolvedValueOnce({ count: 0 });
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(create).not.toHaveBeenCalled();
    const claim = db.aiTriage.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ tenantId: T, activityId: "a1", attempts: { lt: 3 } });
    expect(JSON.stringify(claim.where.OR)).toContain("PENDING");
    expect(JSON.stringify(claim.where.OR)).toContain("FAILED");
    expect(JSON.stringify(claim.where.OR)).toContain("RUNNING");
    expect(claim.data).toMatchObject({ status: "RUNNING", attempts: { increment: 1 } });
    expect(db.activity.findFirst).not.toHaveBeenCalled();
  });
});

describe("processTriage: the opt-out rule", () => {
  it("puts an opt-out card in front of the owner for a clear STOP, with no model call, whatever the customer is", async () => {
    text = "STOP";
    db.contact.findFirst.mockResolvedValue(contact({ source: "WhatsApp" })); // even a brand new number
    db.activity.count.mockResolvedValue(0);
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(create).not.toHaveBeenCalled();
    const [card] = cardsMade();
    expect(card).toMatchObject({ kind: "CONTACT_OPT_OUT", dedupeKey: "wa:a1:optout", source: "WHATSAPP", raw: { contactId: "c1" } });
    expect(card.extraLines).toEqual([{ label: "They wrote", value: "STOP" }]);
    expect(lastUpdate().data).toMatchObject({ status: "DONE", label: "WANTS_TO_STOP", skipReason: "rule", cards: 1 });
  });

  it("still does it when the daily cap and the ceiling are used up", async () => {
    text = "please stop messaging me";
    db.aiTriage.count.mockResolvedValue(999);
    usage.mockResolvedValue(99_000_000);
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(modelSays(verdict())) });
    expect(cardsMade().map((c) => c.kind)).toEqual(["CONTACT_OPT_OUT"]);
  });

  it("makes no card for someone who has already been marked as opted out", async () => {
    text = "STOP";
    db.contact.findFirst.mockResolvedValue(contact({ whatsappOptIn: false }));
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(modelSays(verdict())) });
    expect(proposals.createBackgroundProposal).not.toHaveBeenCalled();
    expect(lastUpdate().data).toMatchObject({ status: "SKIPPED", skipReason: "already_opted_out" });
  });
});

describe("processTriage: when no model call is made", () => {
  const skipped = async (reason: string) => {
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(create).not.toHaveBeenCalled();
    expect(proposals.createBackgroundProposal).not.toHaveBeenCalled();
    expect(lastUpdate().data).toMatchObject({ status: "SKIPPED", skipReason: reason });
  };

  it("skips a number we found through WhatsApp that nobody has replied to yet (a stranger cannot spend the budget)", async () => {
    db.contact.findFirst.mockResolvedValue(contact({ source: "WhatsApp" }));
    db.activity.count.mockResolvedValue(0);
    await skipped("new_number");
    expect(db.activity.count.mock.calls[0][0].where).toEqual({ tenantId: T, contactId: "c1", type: "WHATSAPP", direction: "OUT" });
  });

  it("triages that same number once someone has replied", async () => {
    db.contact.findFirst.mockResolvedValue(contact({ source: "WhatsApp" }));
    db.activity.count.mockResolvedValue(1);
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it(`skips a customer who has already had ${TRIAGE_PER_CONTACT_PER_HOUR} model calls in the last hour`, async () => {
    db.aiTriage.count.mockImplementation(async (a: { where: { contactId?: string } }) => (a.where.contactId ? TRIAGE_PER_CONTACT_PER_HOUR : 0));
    await skipped("contact_limit");
  });

  it("skips once the business has used its daily number of model calls (100 unless the admin changed it)", async () => {
    db.aiTriage.count.mockImplementation(async (a: { where: { contactId?: string } }) => (a.where.contactId ? 0 : 100));
    await skipped("daily_cap");
    settings.mockResolvedValue({ ...on, triageDailyCap: 5 });
    db.aiTriage.count.mockImplementation(async (a: { where: { contactId?: string } }) => (a.where.contactId ? 0 : 4));
    const create = modelSays(verdict());
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(create) });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("counts the day in UTC and the hour back from now, for this business", async () => {
    await processTriage(T, ["a1"], { now: NOW, client: clientWith(modelSays(verdict())) });
    const [hour, day] = db.aiTriage.count.mock.calls.map((c) => c[0].where);
    expect(hour).toMatchObject({ tenantId: T, contactId: "c1", modelCalled: true, createdAt: { gte: new Date("2026-11-04T09:00:00Z") } });
    expect(day).toMatchObject({ tenantId: T, modelCalled: true, createdAt: { gte: new Date("2026-11-04T00:00:00Z") } });
  });

  it("skips when the monthly limit is spent, or there is no key", async () => {
    usage.mockResolvedValue(11_000_000);
    await skipped("ceiling");
    usage.mockResolvedValue(0);
    integ.mockResolvedValue(null);
    await processTriage(T, ["a2"], { now: NOW });
    expect(lastUpdate().data).toMatchObject({ status: "SKIPPED", skipReason: "no_key" });
    expect(clientFor).not.toHaveBeenCalled();
  });

  it("skips when triage was switched off after the message was queued, when the customer is gone, or has no active owner", async () => {
    settings.mockResolvedValue({ ...on, triageEnabled: false });
    await skipped("switched_off");
    settings.mockResolvedValue(on);
    db.contact.findFirst.mockResolvedValue(null);
    await skipped("customer_gone");
    db.contact.findFirst.mockResolvedValue(contact());
    db.user.findFirst.mockResolvedValue(null);
    await skipped("no_owner");
    expect(db.user.findFirst.mock.calls.at(-1)![0].where).toMatchObject({ id: "u-sales", tenantId: T, isActive: true });
  });

  it("skips in a workspace that is read-only until its subscription is renewed", async () => {
    db.tenant.findFirst.mockResolvedValue({ status: "SUSPENDED", plan: "internal", billingStatus: "NONE", trialEndsAt: null, currentPeriodEnd: null, deletionRequestedAt: null });
    await skipped("read_only");
  });
});

describe("retryPendingTriage (the daily job)", () => {
  it("picks up queued, failed and stuck messages from the last day that have tries left, and processes them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // no model client is wired here, so each one fails and is left for the next try
    db.aiTriage.findMany.mockResolvedValue([{ activityId: "a1" }, { activityId: "a2" }]);
    expect(await retryPendingTriage(T, NOW)).toBe(2);
    const q = db.aiTriage.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ tenantId: T, attempts: { lt: 3 }, createdAt: { gte: new Date("2026-11-03T10:00:00Z") } });
    expect(JSON.stringify(q.where.OR)).toContain("PENDING");
    expect(JSON.stringify(q.where.OR)).toContain("FAILED");
    expect(JSON.stringify(q.where.OR)).toContain("RUNNING");
    expect(q.take).toBe(50);
    expect(db.aiTriage.updateMany.mock.calls.filter((c) => c[0].data.status === "RUNNING").map((c) => c[0].where.activityId)).toEqual(["a1", "a2"]);
  });
});
