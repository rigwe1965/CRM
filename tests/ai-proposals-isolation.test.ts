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
      await t.db.automationSetting.create({ data: { tenantId: f.tenantId, key: "assistant", config: { enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true }, updatedById: f.admin } });
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
    const seenByB = await inTenant(t.b, () => (holder.db as { aiProposal: { findMany: () => Promise<unknown[]> } }).aiProposal.findMany());
    expect(seenByB).toEqual([]);
  });

  it("a business that has not allowed proposed actions gets none", async () => {
    await t.db.automationSetting.update({ where: { tenantId_key: { tenantId: t.b.tenantId, key: "assistant" } }, data: { config: { enabled: true, monthlyCeilingUsd: 10 } } });
    await expect(proposeAs(t.b, "TASK_CREATE", { title: "x" })).rejects.toThrow(/switched off/);
  });
});
