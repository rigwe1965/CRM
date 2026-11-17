import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { withTenant } from "@/lib/tenant-context";
import { createTwoTenants, testDatabaseUrl, type TenantFixture, type TwoTenants } from "./helpers/two-tenants";

// The daily "Suggested actions" inbox against a real database that holds two businesses: a person only gets suggestions
// about records they can see, a day's run happens once, suggestions are not repeated, other people's cards stay theirs,
// and the business that has not switched the inbox on gets nothing. Real rules and queries; no model is called (the run is
// given no client, so the cards use their plain wording). Needs TEST_DATABASE_URL.

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

import { runInboxForUser } from "@/lib/ai/inbox/run";
import { approveProposal, declineProposal, listInbox } from "@/lib/ai/proposals";

const run = testDatabaseUrl() ? describe : describe.skip;
const WED = new Date("2026-11-04T09:00:00Z");
const THU = new Date("2026-11-05T09:00:00Z");
const FRI = new Date("2026-11-06T09:00:00Z");

run("the daily inbox across two businesses", () => {
  let t: TwoTenants;
  let adminDeal: string;
  const user = (f: TenantFixture, role: "ADMIN" | "SALES") => ({ id: role === "ADMIN" ? f.admin : f.sales, tenantId: f.tenantId, role, name: "Tester", email: "t@x.test", tenantWritable: true }) as never;
  const inTenant = <T,>(f: TenantFixture, fn: () => Promise<T>) => withTenant(f.tenantId, fn);
  const daily = (f: TenantFixture, userId: string) => t.db.aiProposal.findMany({ where: { tenantId: f.tenantId, userId, source: "DAILY" }, orderBy: { dedupeKey: "asc" } });
  const settingsFor = (f: TenantFixture, inbox: boolean) =>
    t.db.automationSetting.upsert({
      where: { tenantId_key: { tenantId: f.tenantId, key: "assistant" } },
      create: { tenantId: f.tenantId, key: "assistant", config: { enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, inboxEnabled: inbox }, updatedById: f.admin },
      update: { config: { enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, inboxEnabled: inbox } },
    });

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    // Proposals expire a few days after their creation date (WED). Decline and approve read the real clock, so without this the
    // tests only passed in the week they were written and then failed with "already expired". Only Date is faked: timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WED);
    // A clean slate: no fixture tasks or notes that would count as a recent follow-up.
    for (const f of [t.a, t.b]) {
      await t.db.task.deleteMany({ where: { tenantId: f.tenantId } });
      await t.db.activity.deleteMany({ where: { tenantId: f.tenantId } });
      // The fixture deal is 300 with 100 paid; make its one instalment 200 and long overdue, so 100 is late.
      await t.db.instalment.updateMany({ where: { tenantId: f.tenantId }, data: { dueDate: new Date("2026-10-20T00:00:00Z"), amount: 200 } });
    }
    // A second overdue deal in business A that only the admin owns.
    const d = await t.db.deal.create({ data: { tenantId: t.a.tenantId, title: "Admin-only deal", amount: 300, ownerId: t.a.admin, contactId: t.a.contact } });
    adminDeal = d.id;
    await t.db.instalment.create({ data: { tenantId: t.a.tenantId, dealId: d.id, position: 1, dueDate: new Date("2026-10-18T00:00:00Z"), amount: 300 } });
    await settingsFor(t.a, true);
    await settingsFor(t.b, false);
  }, 60_000);
  afterAll(async () => {
    vi.useRealTimers();
    holder.db = null;
    await t?.dispose();
  });

  it("gives a salesperson suggestions about their own deals only, as cards that belong to them and to no chat", async () => {
    const out = await inTenant(t.a, () => runInboxForUser(user(t.a, "SALES"), { now: WED, client: null }));
    expect(out.status).toBe("done");
    expect(out.created).toBeGreaterThan(0);
    const rows = await daily(t.a, t.a.sales);
    expect(rows.length).toBe(out.created);
    for (const r of rows) {
      expect(r).toMatchObject({ tenantId: t.a.tenantId, userId: t.a.sales, conversationId: null, source: "DAILY", status: "PENDING" });
      expect(r.subjectId).toBe(t.a.deal);
      expect(r.dedupeKey).toMatch(/^inst:.+:2026-W45:(task|msg)$/);
      expect(r.reason).toMatch(/overdue for \d+ days/);
      expect(r.expiresAt.getTime()).toBe(WED.getTime() + 3 * 86_400_000);
    }
    expect(rows.some((r) => r.subjectId === adminDeal)).toBe(false);
    expect(rows.find((r) => r.kind === "TASK_CREATE")).toBeTruthy();
  });

  it("makes a day's suggestions once, however often the app is opened", async () => {
    const before = await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId } });
    const again = await inTenant(t.a, () => runInboxForUser(user(t.a, "SALES"), { now: WED, client: null }));
    expect(again.status).toBe("already");
    expect(await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId } })).toBe(before);
    expect(await t.db.aiInboxRun.count({ where: { tenantId: t.a.tenantId, userId: t.a.sales, day: "2026-11-04" } })).toBe(1);
  });

  it("gives the admin the whole business, never the other business, and keeps each person's cards their own", async () => {
    const out = await inTenant(t.a, () => runInboxForUser(user(t.a, "ADMIN"), { now: WED, client: null }));
    expect(out.status).toBe("done");
    const subjects = new Set((await daily(t.a, t.a.admin)).map((r) => r.subjectId));
    expect(subjects).toEqual(new Set([t.a.deal, adminDeal]));
    // The salesperson still has only their own, and sees none of the admin's.
    const inbox = await inTenant(t.a, () => listInbox({ id: t.a.sales, tenantId: t.a.tenantId }, WED));
    expect(inbox.length).toBeGreaterThan(0);
    expect((await t.db.aiProposal.findMany({ where: { id: { in: inbox.map((i) => i.id) } } })).every((r) => r.userId === t.a.sales)).toBe(true);
    expect(await t.db.aiProposal.count({ where: { tenantId: t.b.tenantId, source: "DAILY" } })).toBe(0);
  });

  it("makes nothing for a business that has not switched the inbox on", async () => {
    const out = await inTenant(t.b, () => runInboxForUser(user(t.b, "ADMIN"), { now: WED, client: null }));
    expect(out.status).toBe("disabled");
    expect(await t.db.aiProposal.count({ where: { tenantId: t.b.tenantId } })).toBe(1); // only the fixture's own
    expect(await t.db.aiInboxRun.count({ where: { tenantId: t.b.tenantId, day: "2026-11-04" } })).toBe(0);
  });

  it("does not repeat a suggestion the next day, nor one that was declined, within the same week", async () => {
    const mine = await daily(t.a, t.a.sales);
    await inTenant(t.a, () => declineProposal({ id: t.a.sales, tenantId: t.a.tenantId }, mine[0].id));
    const before = await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId, userId: t.a.sales } });
    const out = await inTenant(t.a, () => runInboxForUser(user(t.a, "SALES"), { now: THU, client: null }));
    expect(out).toEqual({ status: "done", created: 0 });
    expect(await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId, userId: t.a.sales } })).toBe(before);
    expect(await t.db.aiInboxRun.count({ where: { tenantId: t.a.tenantId, userId: t.a.sales, day: { in: ["2026-11-04", "2026-11-05"] } } })).toBe(2); // one per day
  });

  it("approving a suggestion does what the card says, as that person, in their business only", async () => {
    const card = (await daily(t.a, t.a.sales)).find((r) => r.kind === "TASK_CREATE" && r.status === "PENDING");
    expect(card).toBeTruthy();
    const bTasks = await t.db.task.count({ where: { tenantId: t.b.tenantId } });
    const done = await inTenant(t.a, () => approveProposal(user(t.a, "SALES"), card!.id, {}));
    expect(done.status).toBe("APPLIED");
    const task = await t.db.task.findFirst({ where: { tenantId: t.a.tenantId, title: { startsWith: "Follow up on overdue payment" } } });
    expect(task).toMatchObject({ assigneeId: t.a.sales, createdById: t.a.sales, dealId: t.a.deal });
    expect(await t.db.task.count({ where: { tenantId: t.b.tenantId } })).toBe(bTasks);
    // and the admin cannot approve the salesperson's card
    const other = (await daily(t.a, t.a.sales)).find((r) => r.status === "PENDING");
    if (other) await expect(inTenant(t.a, () => approveProposal(user(t.a, "ADMIN"), other.id, {}))).rejects.toMatchObject({ status: 404 });
  });

  it("makes nothing for someone who muted the suggestions", async () => {
    await t.db.user.update({ where: { id: t.a.sales }, data: { aiSuggestionsMuted: true } });
    const before = await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId, userId: t.a.sales } });
    const out = await inTenant(t.a, () => runInboxForUser(user(t.a, "SALES"), { now: FRI, client: null }));
    expect(out.status).toBe("muted");
    expect(await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId, userId: t.a.sales } })).toBe(before);
  });

  it("the database itself hides one business's run records and suggestions from the other", async () => {
    if (!t.rls) return;
    const db = holder.db as { aiInboxRun: { findMany: () => Promise<unknown[]> }; aiProposal: { findMany: (a: object) => Promise<{ tenantId: string }[]> } };
    expect(await inTenant(t.b, () => db.aiInboxRun.findMany())).toEqual([expect.objectContaining({ tenantId: t.b.tenantId })]); // only the fixture's own
    expect((await inTenant(t.b, () => db.aiProposal.findMany({}))).every((r) => r.tenantId === t.b.tenantId)).toBe(true);
  });
});
