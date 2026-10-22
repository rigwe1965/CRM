import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, platformDb, audit } = vi.hoisted(() => ({
  db: {
    automationSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    contact: { findMany: vi.fn(), count: vi.fn() },
  },
  // The daily run lists businesses as the platform, then runs each one as itself.
  platformDb: { tenant: { findMany: vi.fn() } },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/platform-db", () => ({ platformDb }));
vi.mock("@/lib/audit", () => ({ audit }));

import {
  automationsUpdateSchema,
  DEFAULT_STAGE_TASKS,
  renderTitle,
  resolveQuietLeads,
  resolveStageTasks,
} from "@/lib/automations/config";
import { QUIET_LEAD_LIMIT, quietLeadWhere, runQuietLeadNudges } from "@/lib/automations/quiet-leads";
import { runStageAutomations } from "@/lib/automations/stage-tasks";
import { runDailyAutomations } from "@/lib/automations";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-23T08:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.automationSetting.findUnique.mockResolvedValue(null);
  platformDb.tenant.findMany.mockResolvedValue([{ id: "t1" }]);
  db.task.findFirst.mockResolvedValue(null);
  db.task.create.mockResolvedValue({ id: "t1", title: "x" });
  db.task.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});
afterEach(() => vi.useRealTimers());

const stored = (key: string, config: unknown) =>
  db.automationSetting.findUnique.mockImplementation(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) =>
    where.tenantId_key.tenantId === "t1" && where.tenantId_key.key === key ? { key, config } : null);

describe("config", () => {
  it("ships switched off, with three stage rules ready to go", () => {
    const c = resolveStageTasks(undefined);
    expect(c.enabled).toBe(false);
    expect(Object.entries(c.stages).filter(([, r]) => r.enabled && r.title).map(([k]) => k)).toEqual(["PROPOSAL", "NEGOTIATION", "CLOSED_WON"]);
    expect(resolveQuietLeads(undefined)).toEqual({ enabled: false, days: 7 });
  });

  it("lays saved values over the defaults", () => {
    const c = resolveStageTasks({ enabled: true, stages: { PROPOSAL: { title: "Call {customer}", dueInDays: 3 } } });
    expect(c.enabled).toBe(true);
    expect(c.stages.PROPOSAL).toMatchObject({ enabled: true, title: "Call {customer}", dueInDays: 3, priority: "MEDIUM" });
    expect(c.stages.NEGOTIATION).toEqual(DEFAULT_STAGE_TASKS.stages.NEGOTIATION);
    expect(resolveQuietLeads({ enabled: true, days: 14 })).toEqual({ enabled: true, days: 14 });
  });

  it("falls back to the defaults when saved values are invalid", () => {
    expect(resolveStageTasks({ enabled: true, stages: { PROPOSAL: { dueInDays: -5 } } })).toEqual(DEFAULT_STAGE_TASKS);
    expect(resolveQuietLeads({ enabled: true, days: 0 })).toEqual({ enabled: false, days: 7 });
    expect(resolveQuietLeads("nonsense")).toEqual({ enabled: false, days: 7 });
  });

  it("fills only the known title words and caps the length", () => {
    const vars = { deal: "Order 1", customer: "Ada", stage: "Deposit Paid" };
    expect(renderTitle("Ship {deal} to {customer} ({stage}) {other}", vars)).toBe("Ship Order 1 to Ada (Deposit Paid) {other}");
    expect(renderTitle("  a \n b  ", vars)).toBe("a b");
    expect(renderTitle("x".repeat(500), vars)).toHaveLength(200);
  });

  it("needs at least one automation to save", () => {
    expect(automationsUpdateSchema.safeParse({}).success).toBe(false);
    expect(automationsUpdateSchema.safeParse({ quietLeads: { enabled: true, days: 7 } }).success).toBe(true);
    expect(automationsUpdateSchema.safeParse({ quietLeads: { enabled: true, days: 500 } }).success).toBe(false);
  });
});

describe("runStageAutomations", () => {
  type Deal = Parameters<typeof runStageAutomations>[0]["deal"];
  const deal: Deal = { id: "d1", title: "Adaeze order", ownerId: "owner1", contactId: "c1", contact: { firstName: "Adaeze", lastName: "Okafor" } };
  const move = (to: "PROPOSAL" | "QUALIFICATION" | "CLOSED_WON", from: "QUALIFICATION" | "PROPOSAL" = "QUALIFICATION", d: Deal = deal) =>
    runStageAutomations({ deal: d, from, to, actor: { id: "actor1", tenantId: "t1" } });

  it("does nothing while the automation is off", async () => {
    await move("PROPOSAL");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("creates the task for the owner when a deal enters a configured stage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    stored("stage-tasks", { enabled: true });
    await move("PROPOSAL");
    expect(db.task.create).toHaveBeenCalledOnce();
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({
      title: "Send payment details to Adaeze Okafor",
      priority: "MEDIUM",
      dueDate: new Date(NOW.getTime() + DAY),
      assigneeId: "owner1",
      createdById: "actor1",
      dealId: "d1",
      contactId: "c1",
      automationKey: "stage:d1:PROPOSAL",
      tenantId: "t1",
    });
    expect(audit).toHaveBeenCalledWith({ email: "automation", tenantId: "t1" }, expect.objectContaining({ action: "automation.stage_task", entityId: "d1" }));
  });

  it("falls back to the deal title when the deal has no contact", async () => {
    stored("stage-tasks", { enabled: true });
    await move("PROPOSAL", "QUALIFICATION", { ...deal, contactId: null, contact: null });
    expect(db.task.create.mock.calls[0][0].data.title).toBe("Send payment details to Adaeze order");
  });

  it("does not make a second task while one is still open", async () => {
    stored("stage-tasks", { enabled: true });
    db.task.findFirst.mockResolvedValue({ id: "open" });
    await move("PROPOSAL");
    expect(db.task.findFirst.mock.calls[0][0].where).toMatchObject({ automationKey: "stage:d1:PROPOSAL", status: { in: ["TODO", "IN_PROGRESS"] } });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("skips a stage that is off, has no title, or did not change", async () => {
    stored("stage-tasks", { enabled: true, stages: { PROPOSAL: { enabled: false } } });
    await move("PROPOSAL");
    await move("QUALIFICATION", "PROPOSAL"); // default Inquiry rule has no title
    await move("PROPOSAL", "PROPOSAL");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("never throws, so a failure cannot undo the stage change", async () => {
    stored("stage-tasks", { enabled: true });
    db.task.create.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(move("PROPOSAL")).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("runs each active business on its own settings, never the other's", async () => {
    platformDb.tenant.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    // Only t2 has the rule switched on.
    db.automationSetting.findUnique.mockImplementation(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) =>
      where.tenantId_key.tenantId === "t2" && where.tenantId_key.key === "quiet-leads" ? { config: { enabled: true, days: 7 } } : null);
    db.contact.findMany.mockResolvedValue([{ id: "c1", firstName: "A", lastName: "B", ownerId: "o1" }]);
    expect(await runDailyAutomations(NOW)).toMatchObject({ ok: true, quietLeads: { created: 1 } });
    expect(platformDb.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "ACTIVE" } }));
    expect(db.contact.findMany).toHaveBeenCalledTimes(1);
    expect(db.contact.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t2" });
    expect(db.task.createMany.mock.calls[0][0].data[0]).toMatchObject({ tenantId: "t2" });
  });
});

describe("quiet leads", () => {
  const lead = (n: number) => ({ id: `c${n}`, firstName: "Lead", lastName: String(n), ownerId: `o${n}` });

  it("does nothing while switched off", async () => {
    expect(await runQuietLeadNudges("t1", NOW)).toEqual({ created: 0 });
    expect(db.contact.findMany).not.toHaveBeenCalled();
  });

  it("creates one task per lead for its owner, due tomorrow, with a key per contact", async () => {
    stored("quiet-leads", { enabled: true, days: 7 });
    db.contact.findMany.mockResolvedValue([lead(1), lead(2)]);
    expect(await runQuietLeadNudges("t1", NOW)).toEqual({ created: 2 });
    const { data } = db.task.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      title: "Follow up with Lead 1: no contact in 7 days",
      assigneeId: "o1",
      createdById: "o1",
      contactId: "c1",
      automationKey: "quiet:c1",
      dueDate: new Date(NOW.getTime() + DAY),
      priority: "MEDIUM",
    });
    expect(audit).toHaveBeenCalledWith({ email: "automation", tenantId: "t1" }, expect.objectContaining({ action: "automation.quiet_leads", summary: "2 follow-up tasks created" }));
  });

  it("caps a run and creates nothing when no lead is quiet", async () => {
    stored("quiet-leads", { enabled: true, days: 7 });
    db.contact.findMany.mockResolvedValue([]);
    expect(await runQuietLeadNudges("t1", NOW)).toEqual({ created: 0 });
    expect(db.contact.findMany.mock.calls[0][0].take).toBe(QUIET_LEAD_LIMIT);
    expect(db.task.createMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("selects only live, owned, still-open leads that nobody has touched", () => {
    const cutoff = new Date(NOW.getTime() - 7 * DAY);
    const where = quietLeadWhere("t1", 7, NOW);
    expect(where).toMatchObject({
      tenantId: "t1",
      deletedAt: null,
      type: { in: ["LEAD", "PROSPECT"] },
      ownerId: { not: null },
      owner: { isActive: true },
      createdAt: { lt: cutoff },
    });
    const and = JSON.stringify(where.AND);
    expect(and).toContain('"leadStatus":{"not":"UNQUALIFIED"}'); // unqualified leads are left alone
    expect(and).toContain('"leadStatus":null'); // contacts with no status still count
    expect(and).toContain('"activities":{"none"'); // nothing logged on the contact
    expect(and).toContain('"deals":{"none"'); // nor on any of its deals
    expect(and).toContain('"completedAt"'); // nor a completed task
    expect(and).toContain('"startsWith":"quiet:"'); // no nudge already open or recent
  });
});

describe("runDailyAutomations", () => {
  it("reports a failure instead of stopping the reminders that follow", async () => {
    stored("quiet-leads", { enabled: true, days: 7 });
    db.contact.findMany.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The quiet-lead failure is reported, and the customer-email automation (off here) still ran.
    expect(await runDailyAutomations(NOW)).toMatchObject({ ok: false, quietLeads: { ok: false, created: 0 }, instalmentEmails: { ok: true, sent: 0 } });
    spy.mockRestore();
  });

  it("runs each active business on its own settings, never the other's", async () => {
    platformDb.tenant.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    // Only t2 has the rule switched on.
    db.automationSetting.findUnique.mockImplementation(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) =>
      where.tenantId_key.tenantId === "t2" && where.tenantId_key.key === "quiet-leads" ? { config: { enabled: true, days: 7 } } : null);
    db.contact.findMany.mockResolvedValue([{ id: "c1", firstName: "A", lastName: "B", ownerId: "o1" }]);
    expect(await runDailyAutomations(NOW)).toMatchObject({ ok: true, quietLeads: { created: 1 } });
    expect(platformDb.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "ACTIVE" } }));
    expect(db.contact.findMany).toHaveBeenCalledTimes(1);
    expect(db.contact.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t2" });
    expect(db.task.createMany.mock.calls[0][0].data[0]).toMatchObject({ tenantId: "t2" });
  });
});
