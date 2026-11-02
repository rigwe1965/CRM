import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { withTenant } from "@/lib/tenant-context";
import { createTwoTenants, testDatabaseUrl, type TenantFixture, type TwoTenants } from "./helpers/two-tenants";

// Proposals against a real database that holds two businesses: Ivy can only propose about, and a person can only
// approve in, their own business; approving really creates the record there and nowhere else; and nobody can see or
// decide another person's proposal. Real code and queries; only the session is faked. Needs TEST_DATABASE_URL.

const { holder, lazy } = vi.hoisted(() => {
  const holder = { db: null as unknown };
  const lazy = (pick: () => unknown) =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          const target = pick() as Record<string | symbol, unknown>;
          const v = target[key];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      },
    );
  return { holder, lazy };
});
vi.mock("@/lib/db", () => ({ db: lazy(() => holder.db) }));

import { approveProposal, declineProposal, listProposals, propose } from "@/lib/ai/proposals";

const run = testDatabaseUrl() ? describe : describe.skip;

run("Ivy's proposals across two businesses", () => {
  let t: TwoTenants;
  const conv: Record<string, string> = {};
  const user = (f: TenantFixture, role: "ADMIN" | "SALES" = "ADMIN") => ({ id: role === "ADMIN" ? f.admin : f.sales, tenantId: f.tenantId, role, name: "Tester", email: "t@x.test", tenantWritable: true }) as never;
  const inTenant = <T,>(f: TenantFixture, fn: () => Promise<T>) => withTenant(f.tenantId, fn);
  const proposeAs = (f: TenantFixture, kind: Parameters<typeof propose>[1], raw: unknown, who = user(f)) =>
    inTenant(f, () => propose({ user: who, conversationId: conv[f.tenantId], now: new Date() }, kind, raw));

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    for (const f of [t.a, t.b]) {
      await t.db.automationSetting.create({ data: { tenantId: f.tenantId, key: "assistant", config: { enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, paymentProposalsEnabled: f === t.a }, updatedById: f.admin } });
      conv[f.tenantId] = (await t.db.aiConversation.create({ data: { tenantId: f.tenantId, userId: f.admin, promptVersion: "2" } })).id;
    }
  }, 60_000);
  afterAll(async () => {
    holder.db = null;
    await t?.dispose();
  });

  it("will not propose about the other business's contact, deal or task, as if they did not exist", async () => {
    await expect(proposeAs(t.a, "TASK_CREATE", { title: "x", contactId: t.b.contact })).rejects.toThrow();
    await expect(proposeAs(t.a, "NOTE_CREATE", { subject: "x", dealId: t.b.deal })).rejects.toThrow();
    await expect(proposeAs(t.a, "STAGE_CHANGE", { dealId: t.b.deal, stage: "CLOSED_WON" })).rejects.toThrow(/No deal with that id is visible/);
    await expect(proposeAs(t.a, "MESSAGE_DRAFT", { contactId: t.b.contact, channel: "EMAIL", message: "hi" })).rejects.toThrow(/No contact with that id is visible/);
    const theirTask = await t.db.task.findFirst({ where: { tenantId: t.b.tenantId } });
    if (theirTask) await expect(proposeAs(t.a, "TASK_CHANGE", { taskId: theirTask.id, status: "DONE" })).rejects.toThrow(/No task with that id is visible/);
    expect(await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId, conversationId: conv[t.a.tenantId] } })).toBe(0);
  });

  it("proposing writes only a proposal: no task exists until it is approved", async () => {
    const before = await t.db.task.count({ where: { tenantId: t.a.tenantId } });
    const p = await proposeAs(t.a, "TASK_CREATE", { title: "Call Ada about shipping", dueDate: "2026-11-05", contactId: t.a.contact });
    expect(p.preview.lines).toContainEqual({ label: "About", value: "Ada Customer a" });
    expect(await t.db.task.count({ where: { tenantId: t.a.tenantId } })).toBe(before);
    expect(await t.db.aiProposal.findUnique({ where: { id: p.id } })).toMatchObject({ tenantId: t.a.tenantId, userId: t.a.admin, status: "PENDING", kind: "TASK_CREATE" });
  });

  it("approving creates the task in the person's own business, once, and only there", async () => {
    const p = await proposeAs(t.a, "TASK_CREATE", { title: "Chase the Lagos payment", contactId: t.a.contact });
    const bBefore = await t.db.task.count({ where: { tenantId: t.b.tenantId } });
    const done = await inTenant(t.a, () => approveProposal(user(t.a), p.id, { title: "Chase the Lagos payment today" }));
    expect(done).toMatchObject({ status: "APPLIED", result: { entity: "task" } });
    const task = await t.db.task.findFirst({ where: { title: "Chase the Lagos payment today" } });
    expect(task).toMatchObject({ tenantId: t.a.tenantId, createdById: t.a.admin, assigneeId: t.a.admin, contactId: t.a.contact });
    expect(await t.db.task.count({ where: { tenantId: t.b.tenantId } })).toBe(bBefore);
    // a second approval does nothing
    await expect(inTenant(t.a, () => approveProposal(user(t.a), p.id, {}))).rejects.toMatchObject({ status: 409 });
    expect(await t.db.task.count({ where: { title: "Chase the Lagos payment today" } })).toBe(1);
  });

  it("a stage change moves the deal only if it is still where it was", async () => {
    const p = await proposeAs(t.a, "STAGE_CHANGE", { dealId: t.a.deal, stage: "NEGOTIATION" });
    await t.db.deal.update({ where: { id: t.a.deal }, data: { stage: "PROPOSAL" } }); // someone moved it meanwhile
    const out = await inTenant(t.a, () => approveProposal(user(t.a), p.id, {}));
    expect(out.status).toBe("FAILED");
    expect(out.failure).toMatch(/nothing was changed/);
    expect((await t.db.deal.findUnique({ where: { id: t.a.deal } }))?.stage).toBe("PROPOSAL");
  });

  it("nobody can see, approve or decline another person's proposal, in the same business or another", async () => {
    const p = await proposeAs(t.a, "TASK_CREATE", { title: "Private to the admin" });
    const sales = user(t.a, "SALES");
    expect(await inTenant(t.a, () => listProposals(sales, conv[t.a.tenantId]))).toEqual([]);
    await expect(inTenant(t.a, () => approveProposal(sales, p.id, {}))).rejects.toMatchObject({ status: 404 });
    await expect(inTenant(t.a, () => declineProposal(sales, p.id))).rejects.toMatchObject({ status: 404 });
    await expect(inTenant(t.b, () => approveProposal(user(t.b), p.id, {}))).rejects.toMatchObject({ status: 404 });
    expect(await inTenant(t.b, () => listProposals(user(t.b), conv[t.a.tenantId]))).toEqual([]);
    expect((await t.db.aiProposal.findUnique({ where: { id: p.id } }))?.status).toBe("PENDING");
  });

  it("the database itself hides one business's proposals from the other", async () => {
    if (!t.rls) return;
    // The fixture gives every business a proposal of its own, so B sees those, but never one that belongs to A.
    const seenByB = await inTenant(t.b, () => (holder.db as { aiProposal: { findMany: () => Promise<{ tenantId: string }[]> } }).aiProposal.findMany());
    expect(seenByB.length).toBeGreaterThan(0);
    expect(seenByB.filter((p) => p.tenantId !== t.b.tenantId)).toEqual([]);
  });

  // ── Wave B: payments, contacts and deals ────────────────────────────────────────────────────────────────────
  const paid = async (dealId: string) => Number((await t.db.payment.aggregate({ where: { dealId }, _sum: { amount: true } }))._sum.amount ?? 0);

  it("will not propose a payment or a deal against the other business's deal or customer", async () => {
    await expect(proposeAs(t.a, "PAYMENT_RECORD", { dealId: t.b.deal, amount: 10 })).rejects.toThrow(/No deal with that id is visible/);
    await expect(proposeAs(t.a, "DEAL_CREATE", { contactId: t.b.contact, title: "Sneaky", currency: "USD", items: [{ productType: "Closure", quantity: 1, unitPrice: 10 }] })).rejects.toThrow();
    expect(await t.db.deal.count({ where: { title: "Sneaky" } })).toBe(0);
  });

  it("refuses a payment above the balance, and another currency, and a business without payment proposals", async () => {
    await expect(proposeAs(t.a, "PAYMENT_RECORD", { dealId: t.a.deal, amount: 1000 })).rejects.toThrow(/more than the balance/);
    await expect(proposeAs(t.a, "PAYMENT_RECORD", { dealId: t.a.deal, amount: 10, currency: "EUR" })).rejects.toThrow(/not EUR/);
    await expect(proposeAs(t.b, "PAYMENT_RECORD", { dealId: t.b.deal, amount: 10 })).rejects.toThrow(/Payment proposals .*switched off/);
  });

  it("an approved payment lands once, in the person's business only, and warns about the open payment link first", async () => {
    const p = await proposeAs(t.a, "PAYMENT_RECORD", { dealId: t.a.deal, amount: 50, reference: "TRX-1" });
    expect(p.preview.warning).toMatch(/open online payment link/);
    expect(p.preview.lines).toContainEqual({ label: "Balance", value: "200.00 → 150.00 USD" });
    const before = { a: await paid(t.a.deal), b: await paid(t.b.deal) };
    const done = await inTenant(t.a, () => approveProposal(user(t.a), p.id, {}));
    expect(done.status).toBe("APPLIED");
    expect(await paid(t.a.deal)).toBe(before.a + 50);
    expect(await paid(t.b.deal)).toBe(before.b);
    expect(await t.db.payment.findFirst({ where: { dealId: t.a.deal, reference: "TRX-1" } })).toMatchObject({ tenantId: t.a.tenantId, recordedById: t.a.admin });
    expect(await t.db.auditLog.count({ where: { tenantId: t.a.tenantId, action: "payment.recorded" } })).toBeGreaterThan(0);
  });

  it("a payment recorded in between makes the approval do nothing", async () => {
    const p = await proposeAs(t.a, "PAYMENT_RECORD", { dealId: t.a.deal, amount: 10 });
    await t.db.payment.create({ data: { tenantId: t.a.tenantId, dealId: t.a.deal, amount: 5, paidAt: new Date(), recordedById: t.a.sales } });
    const before = await paid(t.a.deal);
    const out = await inTenant(t.a, () => approveProposal(user(t.a), p.id, {}));
    expect(out.status).toBe("FAILED");
    expect(out.failure).toMatch(/Another payment was recorded/);
    expect(await paid(t.a.deal)).toBe(before);
  });

  it("two approvals at once record one payment", async () => {
    const p = await proposeAs(t.a, "PAYMENT_RECORD", { dealId: t.a.deal, amount: 7 });
    const before = await paid(t.a.deal);
    const results = await Promise.allSettled([inTenant(t.a, () => approveProposal(user(t.a), p.id, {})), inTenant(t.a, () => approveProposal(user(t.a), p.id, {}))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await paid(t.a.deal)).toBe(before + 7);
  });

  it("a contact is created in the person's business, owned by them, after a duplicate warning", async () => {
    const p = await proposeAs(t.a, "CONTACT_CREATE", { firstName: "Ada", lastName: "Customer a", phone: "+2348099999999" });
    expect(p.preview.warning).toMatch(/Possible duplicate: Ada Customer a/);
    const done = await inTenant(t.a, () => approveProposal(user(t.a), p.id, { firstName: "Adaora" }));
    expect(done.status).toBe("APPLIED");
    expect(await t.db.contact.findFirst({ where: { firstName: "Adaora" } })).toMatchObject({ tenantId: t.a.tenantId, ownerId: t.a.admin, phoneE164: "+2348099999999", type: "LEAD", whatsappOptIn: false });
  });

  it("a deal is created with its items and a total the CRM worked out", async () => {
    const p = await proposeAs(t.a, "DEAL_CREATE", { contactId: t.a.contact, title: "Wave B order", currency: "usd", items: [{ productType: "Closure", quantity: 2, unitPrice: 50.25 }] });
    expect(p.preview.lines).toContainEqual({ label: "Total", value: "100.50 USD" });
    const done = await inTenant(t.a, () => approveProposal(user(t.a), p.id, { title: "Wave B order (edited)" }));
    expect(done.status).toBe("APPLIED");
    const deal = await t.db.deal.findFirst({ where: { title: "Wave B order (edited)" }, include: { items: true } });
    expect(deal).toMatchObject({ tenantId: t.a.tenantId, ownerId: t.a.admin, stage: "QUALIFICATION", currency: "USD", contactId: t.a.contact });
    expect(Number(deal!.amount)).toBe(100.5);
    expect(deal!.items).toHaveLength(1);
  });

  // ── Phase 3a: instalment schedules ──────────────────────────────────────────────────────────────────────────
  const dueDates = async (dealId: string) => (await t.db.instalment.findMany({ where: { dealId }, orderBy: { position: "asc" } })).map((i) => `${i.dueDate.toISOString().slice(0, 10)}:${Number(i.amount).toFixed(2)}`);
  const future = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it("will not propose a schedule on the other business's deal, or in a business without payment proposals", async () => {
    await expect(proposeAs(t.a, "SCHEDULE_REPLACE", { dealId: t.b.deal, even: { count: 3, firstDueDate: future(30), every: "MONTH" } })).rejects.toThrow(/No deal with that id is visible/);
    await expect(proposeAs(t.b, "SCHEDULE_REPLACE", { dealId: t.b.deal, even: { count: 3, firstDueDate: future(30), every: "MONTH" } })).rejects.toThrow(/switched off/);
  });

  it("an approved schedule replaces the old one in the person's business only, and records the before and after", async () => {
    const bBefore = await dueDates(t.b.deal);
    const p = await proposeAs(t.a, "SCHEDULE_REPLACE", { dealId: t.a.deal, even: { count: 3, firstDueDate: future(30), every: "MONTH" } });
    expect(p.preview.warning).toMatch(/replaces the current schedule of 1 instalment/);
    expect(p.preview.lines).toContainEqual({ label: "Scheduled", value: "300.00 USD in 3 instalments" });
    const done = await inTenant(t.a, () => approveProposal(user(t.a), p.id, {}));
    expect(done.status).toBe("APPLIED");
    const now = await dueDates(t.a.deal);
    expect(now).toHaveLength(3);
    expect(now.map((x) => x.split(":")[1])).toEqual(["100.00", "100.00", "100.00"]);
    expect(await dueDates(t.b.deal)).toEqual(bBefore);
    const entry = await t.db.auditLog.findFirst({ where: { tenantId: t.a.tenantId, action: "schedule.replaced", entityId: t.a.deal }, orderBy: { createdAt: "desc" } });
    expect(entry).not.toBeNull();
  });

  it("a payment or a schedule change in between makes the approval do nothing", async () => {
    const p = await proposeAs(t.a, "SCHEDULE_REPLACE", { dealId: t.a.deal, even: { count: 2, firstDueDate: future(45), every: "WEEK" } });
    await t.db.instalment.create({ data: { tenantId: t.a.tenantId, dealId: t.a.deal, position: 4, dueDate: new Date(Date.now() + 90 * 86_400_000), amount: 1 } });
    const before = await dueDates(t.a.deal);
    const out = await inTenant(t.a, () => approveProposal(user(t.a), p.id, {}));
    expect(out.status).toBe("FAILED");
    expect(out.failure).toMatch(/changed after Ivy suggested this/);
    expect(await dueDates(t.a.deal)).toEqual(before);
  });

  it("two approvals at once replace the schedule once", async () => {
    await t.db.instalment.deleteMany({ where: { dealId: t.a.deal, position: 4 } });
    const p = await proposeAs(t.a, "SCHEDULE_REPLACE", { dealId: t.a.deal, even: { count: 2, firstDueDate: future(60), every: "WEEK" } });
    const results = await Promise.allSettled([inTenant(t.a, () => approveProposal(user(t.a), p.id, {})), inTenant(t.a, () => approveProposal(user(t.a), p.id, {}))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await dueDates(t.a.deal)).toHaveLength(2);
  });

  it("a business that has not allowed proposed actions gets none", async () => {
    await t.db.automationSetting.update({ where: { tenantId_key: { tenantId: t.b.tenantId, key: "assistant" } }, data: { config: { enabled: true, monthlyCeilingUsd: 10 } } });
    await expect(proposeAs(t.b, "TASK_CREATE", { title: "x" })).rejects.toThrow(/switched off/);
  });
});
