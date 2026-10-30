import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, settings, rules, wording, proposals, integ, client, usage } = vi.hoisted(() => ({
  db: { user: { findFirst: vi.fn() }, aiInboxRun: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() } },
  settings: vi.fn(),
  rules: { findCandidates: vi.fn() },
  wording: { writeWording: vi.fn() },
  proposals: { createBackgroundProposal: vi.fn() },
  integ: vi.fn(),
  client: vi.fn(),
  usage: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/settings", () => ({ loadAssistantSettings: settings }));
vi.mock("@/lib/ai/inbox/rules", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/inbox/rules")>()), findCandidates: rules.findCandidates }));
vi.mock("@/lib/ai/inbox/wording", () => wording);
vi.mock("@/lib/ai/proposals", () => proposals);
vi.mock("@/lib/integrations", () => ({ getIntegration: integ }));
vi.mock("@/lib/ai/client", () => ({ anthropicFor: client }));
vi.mock("@/lib/ai/usage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/usage")>()), monthToDateMicros: usage }));

import { Prisma } from "@prisma/client";
import { ToolError } from "@/lib/ai/tools/types";
import { inboxAvailability, runInboxForUser, runToday } from "@/lib/ai/inbox/run";

const NOW = new Date("2026-10-30T09:00:00Z");
const user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", tenantWritable: true } as never;
const dup = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });

const task = (key: string, extra: Record<string, unknown> = {}) => ({
  rule: "OVERDUE_INSTALMENT", key, priority: 100, subject: { type: "deal", id: "d" + key }, reason: "because " + key,
  facts: { customer: "Ada", deal: "D", amountText: "1 USD", daysLate: 3, dueDate: "2026-10-27", recentSubjects: [] },
  task: { title: "Follow up " + key, priority: "MEDIUM", dueDate: "2026-10-30", dealId: "d" + key }, taskChange: null, message: null, ...extra,
});
const withMessage = (key: string, text = "Hi Ada, a reminder.") => task(key, { message: { contactId: "c1", channel: "EMAIL", subject: "Payment reminder", text, allowed: ["ada@x.test"] } });

beforeEach(() => {
  vi.resetAllMocks();
  settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, inboxEnabled: true });
  db.user.findFirst.mockResolvedValue({ aiSuggestionsMuted: false });
  db.aiInboxRun.create.mockResolvedValue({});
  db.aiInboxRun.updateMany.mockResolvedValue({ count: 1 });
  usage.mockResolvedValue(0);
  integ.mockResolvedValue({ settings: { apiKey: "k" } });
  client.mockResolvedValue({ beta: {} });
  rules.findCandidates.mockResolvedValue([]);
  wording.writeWording.mockResolvedValue({ words: new Map(), costMicros: 0 });
  proposals.createBackgroundProposal.mockResolvedValue({ id: "p" });
});

describe("inboxAvailability", () => {
  it("is on only when Ivy and the daily suggestions are both on, the person has not muted them, and the workspace is writable", async () => {
    expect(await inboxAvailability(user)).toBe("ok");
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true });
    expect(await inboxAvailability(user)).toBe("disabled");
    settings.mockResolvedValue({ enabled: false, monthlyCeilingUsd: null, inboxEnabled: true });
    expect(await inboxAvailability(user)).toBe("disabled");
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, inboxEnabled: true });
    expect(await inboxAvailability({ ...(user as object), tenantWritable: false } as never)).toBe("read_only");
    db.user.findFirst.mockResolvedValue({ aiSuggestionsMuted: true });
    expect(await inboxAvailability(user)).toBe("muted");
    expect(db.user.findFirst.mock.calls[0][0].where).toEqual({ id: "u1", tenantId: "t1" });
  });
});

describe("runInboxForUser", () => {
  it("does nothing, and makes no run record, when the inbox is off or muted", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10 });
    expect(await runInboxForUser(user, { now: NOW })).toEqual({ status: "disabled", created: 0 });
    expect(db.aiInboxRun.create).not.toHaveBeenCalled();
    expect(rules.findCandidates).not.toHaveBeenCalled();
  });

  it("claims today's run, finds candidates for this person, and makes a task card for each, as the daily source", async () => {
    rules.findCandidates.mockResolvedValue([task("a"), task("b")]);
    const out = await runInboxForUser(user, { now: NOW });
    expect(out).toEqual({ status: "done", created: 2 });
    expect(db.aiInboxRun.create.mock.calls[0][0].data).toEqual({ tenantId: "t1", userId: "u1", day: "2026-10-30" });
    expect(rules.findCandidates).toHaveBeenCalledWith(user, NOW);
    const first = proposals.createBackgroundProposal.mock.calls[0];
    expect(first[0]).toBe(user);
    expect(first[1]).toMatchObject({ kind: "TASK_CREATE", source: "DAILY", dedupeKey: "a:task", reason: "because a", subject: { type: "deal", id: "da" }, raw: { title: "Follow up a", dealId: "da" } });
    expect(db.aiInboxRun.updateMany.mock.calls.at(-1)![0]).toMatchObject({ where: { tenantId: "t1", userId: "u1", day: "2026-10-30" }, data: { status: "DONE", candidates: 2, created: 2 } });
  });

  it("uses the model's wording when it has some, and the plain template when it has none", async () => {
    rules.findCandidates.mockResolvedValue([withMessage("a"), withMessage("b")]);
    wording.writeWording.mockResolvedValue({ words: new Map([["a", { taskTitle: "Chase Ada politely", message: "Hello Ada, just checking in." }]]), costMicros: 5000 });
    await runInboxForUser(user, { now: NOW });
    const calls = proposals.createBackgroundProposal.mock.calls.map((c) => c[1]);
    expect(calls.find((c) => c.dedupeKey === "a:task").raw.title).toBe("Chase Ada politely");
    expect(calls.find((c) => c.dedupeKey === "a:msg").raw.message).toBe("Hello Ada, just checking in.");
    expect(calls.find((c) => c.dedupeKey === "b:task").raw.title).toBe("Follow up b");
    expect(calls.find((c) => c.dedupeKey === "b:msg").raw.message).toBe("Hi Ada, a reminder.");
    expect(db.aiInboxRun.updateMany.mock.calls.at(-1)![0].data.costMicros).toBe(5000);
  });

  it("warns on the card when a draft holds a link or number that is not in the contact's record", async () => {
    rules.findCandidates.mockResolvedValue([withMessage("a")]);
    wording.writeWording.mockResolvedValue({ words: new Map([["a", { taskTitle: "t", message: "Pay at https://pay.evil.example/x or on 0123456789" }]]), costMicros: 0 });
    await runInboxForUser(user, { now: NOW });
    const all = proposals.createBackgroundProposal.mock.calls.map((c) => c[1]);
    expect(all.find((c) => c.kind === "MESSAGE_DRAFT").extraWarning).toMatch(/link.*that is not from your records/);
    expect(all.find((c) => c.kind === "TASK_CREATE").extraWarning).toBeUndefined();
  });

  it("still makes the cards, with template wording, when the monthly ceiling is spent or there is no key", async () => {
    rules.findCandidates.mockResolvedValue([task("a")]);
    usage.mockResolvedValue(11_000_000); // over the $10 ceiling
    expect(await runInboxForUser(user, { now: NOW })).toEqual({ status: "done", created: 1 });
    expect(wording.writeWording).not.toHaveBeenCalled();
    usage.mockResolvedValue(0);
    integ.mockResolvedValue(null);
    expect(await runInboxForUser(user, { now: new Date("2026-10-31T09:00:00Z") })).toEqual({ status: "done", created: 1 });
    expect(wording.writeWording).not.toHaveBeenCalled();
  });

  it("skips a card whose record changed since the rule ran, and keeps the rest", async () => {
    rules.findCandidates.mockResolvedValue([task("a"), task("b")]);
    proposals.createBackgroundProposal.mockRejectedValueOnce(new ToolError("No deal with that id is visible to you.")).mockResolvedValue({ id: "p" });
    expect(await runInboxForUser(user, { now: NOW })).toEqual({ status: "done", created: 1 });
  });

  it("does not count a suggestion that already exists (the dedupe key), and stops at ten cards", async () => {
    rules.findCandidates.mockResolvedValue([task("a"), task("b")]);
    proposals.createBackgroundProposal.mockResolvedValueOnce(null).mockResolvedValue({ id: "p" });
    expect((await runInboxForUser(user, { now: NOW })).created).toBe(1);
    proposals.createBackgroundProposal.mockReset().mockResolvedValue({ id: "p" });
    rules.findCandidates.mockResolvedValue(Array.from({ length: 10 }, (_, i) => withMessage(String(i))));
    expect((await runInboxForUser(user, { now: new Date("2026-11-02T09:00:00Z") })).created).toBe(10);
    expect(proposals.createBackgroundProposal).toHaveBeenCalledTimes(10);
  });

  it("runs once a day: a second request finds today's run done, or running, and does nothing", async () => {
    db.aiInboxRun.create.mockRejectedValue(dup());
    db.aiInboxRun.updateMany.mockResolvedValue({ count: 0 });
    db.aiInboxRun.findFirst.mockResolvedValue({ status: "DONE", created: 3, startedAt: NOW });
    expect(await runInboxForUser(user, { now: NOW })).toEqual({ status: "already", created: 3 });
    db.aiInboxRun.findFirst.mockResolvedValue({ status: "RUNNING", created: 0, startedAt: NOW });
    expect(await runInboxForUser(user, { now: NOW })).toEqual({ status: "running", created: 0 });
    expect(rules.findCandidates).not.toHaveBeenCalled();
  });

  it("may take over a failed run, or one that died, but only through one conditional update", async () => {
    db.aiInboxRun.create.mockRejectedValue(dup());
    db.aiInboxRun.updateMany.mockResolvedValue({ count: 1 });
    const out = await runInboxForUser(user, { now: NOW });
    expect(out.status).toBe("done");
    const claim = db.aiInboxRun.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ tenantId: "t1", userId: "u1", day: "2026-10-30" });
    expect(JSON.stringify(claim.where.OR)).toContain("FAILED");
    expect(JSON.stringify(claim.where.OR)).toContain("RUNNING");
  });

  it("marks the run failed, never throws, and says nothing about what went wrong", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rules.findCandidates.mockRejectedValue(new Error("db exploded: password=hunter2"));
    const out = await runInboxForUser(user, { now: NOW });
    expect(out).toEqual({ status: "failed", created: 0 });
    expect(db.aiInboxRun.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: "FAILED", error: "The run could not finish." });
    spy.mockRestore();
  });
});

describe("runToday", () => {
  it("reads this person's run for the UTC day", async () => {
    db.aiInboxRun.findFirst.mockResolvedValue({ status: "DONE" });
    await runToday({ id: "u1", tenantId: "t1" }, NOW);
    expect(db.aiInboxRun.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", userId: "u1", day: "2026-10-30" });
  });
});
