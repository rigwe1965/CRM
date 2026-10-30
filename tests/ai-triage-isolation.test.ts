import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { withTenant } from "@/lib/tenant-context";
import { createTwoTenants, testDatabaseUrl, type TenantFixture, type TwoTenants } from "./helpers/two-tenants";

// WhatsApp triage against a real database that holds two businesses: a message is queued and triaged once, the cards go
// to the contact's owner only, a clear "stop" needs no model and a person's approval to take effect, the daily cap holds,
// and nothing crosses into the other business. Real queries and rules; the model is a stub. Needs TEST_DATABASE_URL.

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

import { enqueueTriage, processTriage, retryPendingTriage } from "@/lib/ai/triage/run";
import { approveProposal } from "@/lib/ai/proposals";

const run = testDatabaseUrl() ? describe : describe.skip;
const NOW = new Date();

run("WhatsApp triage across two businesses", () => {
  let t: TwoTenants;
  const inTenant = <T,>(f: TenantFixture, fn: () => Promise<T>) => withTenant(f.tenantId, fn);
  const user = (f: TenantFixture, role: "ADMIN" | "SALES") => ({ id: role === "ADMIN" ? f.admin : f.sales, tenantId: f.tenantId, role, name: "Tester", email: "t@x.test", tenantWritable: true }) as never;
  const settingsFor = (f: TenantFixture, triage: boolean, cap?: number) => {
    const config = { enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, triageEnabled: triage, ...(cap ? { triageDailyCap: cap } : {}) };
    return t.db.automationSetting.upsert({ where: { tenantId_key: { tenantId: f.tenantId, key: "assistant" } }, create: { tenantId: f.tenantId, key: "assistant", config, updatedById: f.admin }, update: { config } });
  };
  const incoming = async (f: TenantFixture, externalId: string, body: string) =>
    (await t.db.activity.create({ data: { tenantId: f.tenantId, type: "WHATSAPP", direction: "IN", subject: "WhatsApp message", body, occurredAt: new Date(), externalId, authorId: f.sales, contactId: f.contact } })).id;
  const verdict = { label: "PAYMENT_CLAIM", urgency: "HIGH", summary: "Says they paid 300 USD.", reply: "Thank you, we will check and confirm shortly.", task: { title: "Check whether the 300 USD payment arrived", priority: "HIGH" } };
  let calls = 0;
  const client = {
    beta: {
      messages: {
        create: async () => {
          calls++;
          return { model: "claude-sonnet-5-5", stop_reason: "tool_use", usage: { input_tokens: 500, output_tokens: 100 }, content: [{ type: "tool_use", name: "triage_result", id: "x", input: verdict }] };
        },
      },
    },
  } as never;
  const cards = (f: TenantFixture) => t.db.aiProposal.findMany({ where: { tenantId: f.tenantId, source: "WHATSAPP" }, orderBy: { dedupeKey: "asc" } });

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    for (const f of [t.a, t.b]) {
      await t.db.contact.update({ where: { id: f.contact }, data: { whatsappOptIn: true } });
    }
    await settingsFor(t.a, true);
    await settingsFor(t.b, false);
  }, 60_000);
  afterAll(async () => {
    holder.db = null;
    await t?.dispose();
  });

  it("queues nothing for a business that has not switched triage on, and a message once for one that has", async () => {
    const b = await incoming(t.b, "wamid.B1", "I paid 300 USD");
    expect(await inTenant(t.b, () => enqueueTriage(t.b.tenantId, ["wamid.B1"]))).toEqual([]);
    expect(await t.db.aiTriage.count({ where: { tenantId: t.b.tenantId, activityId: b } })).toBe(0);

    const a = await incoming(t.a, "wamid.A1", "Hello, I have sent the 300 USD today");
    expect(await inTenant(t.a, () => enqueueTriage(t.a.tenantId, ["wamid.A1"]))).toEqual([a]);
    expect(await inTenant(t.a, () => enqueueTriage(t.a.tenantId, ["wamid.A1"]))).toEqual([]); // Meta delivered it again
    expect(await t.db.aiTriage.count({ where: { tenantId: t.a.tenantId, activityId: a } })).toBe(1);
  });

  it("makes the cards for the contact's owner only, as WhatsApp suggestions with no chat, and never in the other business", async () => {
    const a = (await t.db.activity.findFirstOrThrow({ where: { tenantId: t.a.tenantId, externalId: "wamid.A1" } })).id;
    await inTenant(t.a, () => processTriage(t.a.tenantId, [a], { now: NOW, client }));
    const made = await cards(t.a);
    expect(made.map((c) => c.kind).sort()).toEqual(["MESSAGE_DRAFT", "TASK_CREATE"]);
    for (const c of made) {
      expect(c).toMatchObject({ tenantId: t.a.tenantId, userId: t.a.sales, conversationId: null, source: "WHATSAPP", status: "PENDING", subjectId: t.a.contact });
      expect(c.dedupeKey).toBe(`wa:${a}:${c.kind === "MESSAGE_DRAFT" ? "msg" : "task"}`);
      expect(c.reason).toBe("Payment claim: Says they paid 300 USD.");
    }
    expect((made.find((c) => c.kind === "MESSAGE_DRAFT")!.preview as { lines: { label: string }[] }).lines.map((l) => l.label)).toContain("They wrote");
    expect(await cards(t.b)).toEqual([]);
    expect(await t.db.aiProposal.count({ where: { tenantId: t.a.tenantId, userId: t.a.admin, source: "WHATSAPP" } })).toBe(0);
    expect(await t.db.aiTriage.findFirstOrThrow({ where: { tenantId: t.a.tenantId, activityId: a } })).toMatchObject({ status: "DONE", label: "PAYMENT_CLAIM", urgency: "HIGH", cards: 2, modelCalled: true });
    expect(await t.db.aiUsage.count({ where: { tenantId: t.a.tenantId, purpose: "TRIAGE" } })).toBe(1);
    expect(await t.db.aiUsage.count({ where: { tenantId: t.b.tenantId, purpose: "TRIAGE" } })).toBe(0);
  });

  it("does not triage a message twice, however often it is processed or swept", async () => {
    const before = { calls, cards: (await cards(t.a)).length };
    const a = (await t.db.activity.findFirstOrThrow({ where: { tenantId: t.a.tenantId, externalId: "wamid.A1" } })).id;
    await inTenant(t.a, () => processTriage(t.a.tenantId, [a], { now: NOW, client }));
    await inTenant(t.a, () => retryPendingTriage(t.a.tenantId, NOW));
    expect({ calls, cards: (await cards(t.a)).length }).toEqual(before);
  });

  it("another business's message id does nothing when processed in this business", async () => {
    const b = (await t.db.activity.findFirstOrThrow({ where: { tenantId: t.b.tenantId, externalId: "wamid.B1" } })).id;
    const before = calls;
    await inTenant(t.a, () => processTriage(t.a.tenantId, [b], { now: NOW, client }));
    expect(calls).toBe(before);
    expect(await t.db.aiTriage.count({ where: { tenantId: t.a.tenantId, activityId: b } })).toBe(0);
  });

  it("a clear STOP needs no model: it puts an opt-out card in front of the owner, and consent changes only when they approve", async () => {
    const before = calls;
    const a = await incoming(t.a, "wamid.A2", "STOP");
    await inTenant(t.a, () => enqueueTriage(t.a.tenantId, ["wamid.A2"]));
    await inTenant(t.a, () => processTriage(t.a.tenantId, [a], { now: NOW, client }));
    expect(calls).toBe(before);
    const card = (await cards(t.a)).find((c) => c.kind === "CONTACT_OPT_OUT")!;
    expect(card).toMatchObject({ userId: t.a.sales, status: "PENDING", dedupeKey: `wa:${a}:optout` });
    expect((await t.db.contact.findUniqueOrThrow({ where: { id: t.a.contact } })).whatsappOptIn).toBe(true); // nothing changed yet

    // someone else in the business cannot decide the owner's card
    await expect(inTenant(t.a, () => approveProposal(user(t.a, "ADMIN"), card.id, {}))).rejects.toMatchObject({ status: 404 });
    const done = await inTenant(t.a, () => approveProposal(user(t.a, "SALES"), card.id, {}));
    expect(done.status).toBe("APPLIED");
    expect((await t.db.contact.findUniqueOrThrow({ where: { id: t.a.contact } })).whatsappOptIn).toBe(false);
    expect((await t.db.contact.findUniqueOrThrow({ where: { id: t.b.contact } })).whatsappOptIn).toBe(true); // the other business untouched
  });

  it("stops calling the model once the business's daily number is used, and says why", async () => {
    await t.db.contact.update({ where: { id: t.a.contact }, data: { whatsappOptIn: true } });
    await settingsFor(t.a, true, 1);
    const before = calls;
    const a = await incoming(t.a, "wamid.A3", "Is my order ready?");
    await inTenant(t.a, () => enqueueTriage(t.a.tenantId, ["wamid.A3"]));
    await inTenant(t.a, () => processTriage(t.a.tenantId, [a], { now: NOW, client }));
    expect(calls).toBe(before);
    expect(await t.db.aiTriage.findFirstOrThrow({ where: { tenantId: t.a.tenantId, activityId: a } })).toMatchObject({ status: "SKIPPED", skipReason: "daily_cap", cards: 0 });
  });

  it("the database itself hides one business's triage queue from the other", async () => {
    if (!t.rls) return;
    const db = holder.db as { aiTriage: { findMany: () => Promise<{ tenantId: string }[]> } };
    const seen = await inTenant(t.b, () => db.aiTriage.findMany());
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.tenantId === t.b.tenantId)).toBe(true);
  });
});
