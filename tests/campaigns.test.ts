import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit } = vi.hoisted(() => ({
  db: {
    contact: { count: vi.fn(), findMany: vi.fn() },
    deal: { findMany: vi.fn() },
    payment: { groupBy: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
    campaign: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    campaignRecipient: { groupBy: vi.fn() },
  },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: { id: "u1", tenantId: "t1", role: "ADMIN", name: "Ada", email: "a@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number; code?: string; fieldErrors?: unknown };
      return new Response(JSON.stringify({ code: err.code, details: err.fieldErrors }), { status: err.status ?? 500 });
    }
  },
}));

import { GET as list, POST as create } from "@/app/api/admin/campaigns/route";
import { DELETE as del, GET as one, PATCH as patch } from "@/app/api/admin/campaigns/[id]/route";
import { GET as preview } from "@/app/api/admin/campaigns/audience/route";
import { audienceFor, MAX_AUDIENCE, readAudience } from "@/lib/campaign-audience";
import { checkCampaignTemplate } from "@/lib/campaigns";
import { optInColumns } from "@/lib/whatsapp-optin";
import { campaignAudienceSchema } from "@/lib/validations/crm";

const NOW = new Date("2026-11-20T10:00:00Z");
const A = (over: object = {}) => campaignAudienceSchema.parse(over);
const json = async (res: Response) => (await res.json()) as { data?: any; code?: string; details?: Record<string, string[]> };
const body = (method: string, data: unknown) => new Request("https://x.test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const ctx = (id = "c1") => ({ params: Promise.resolve({ id }) });

const template = (over: object = {}) => ({
  id: "tpl1", name: "new_stock", language: "en", body: "Hi {{1}}, {{2}}", status: "APPROVED", supported: true, active: true,
  slots: [{ label: "First name", source: "firstName" }, { label: "Offer", source: "manual" }], ...over,
});
const row = (over: object = {}) => ({
  id: "c1", name: "November", status: "DRAFT", audience: A(), values: ["", "10% off"], templateId: "tpl1", startedAt: null, finishedAt: null,
  createdAt: NOW, updatedAt: NOW, template: { name: "new_stock", language: "en" }, createdBy: { id: "u1", name: "Ada" }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.whatsappTemplate.findFirst.mockResolvedValue(template());
  db.campaign.findFirst.mockResolvedValue(row());
  db.campaign.create.mockImplementation(async ({ data }) => row({ ...data }));
  db.campaign.update.mockImplementation(async ({ data }) => row({ ...data }));
  db.campaign.deleteMany.mockResolvedValue({ count: 1 });
  db.contact.count.mockResolvedValue(0);
  db.contact.findMany.mockResolvedValue([]);
  db.deal.findMany.mockResolvedValue([]);
  db.payment.groupBy.mockResolvedValue([]);
});

describe("audience", () => {
  it("always requires the WhatsApp tick and a WhatsApp-ready number, in this business, and never deleted contacts", async () => {
    await audienceFor("t1", A(), { now: NOW });
    const reachable = db.contact.count.mock.calls[1][0].where;
    expect(reachable).toMatchObject({ tenantId: "t1", deletedAt: null, whatsappOptIn: true, phoneE164: { not: null } });
    expect(db.contact.count.mock.calls[0][0].where).not.toHaveProperty("whatsappOptIn");
  });

  it("counts who matches but can't be messaged, separately", async () => {
    db.contact.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    db.contact.findMany.mockResolvedValue([{ id: "a", firstName: "Ada", lastName: "Okafor" }, { id: "b", firstName: "Chi", lastName: "-" }]);
    const p = await audienceFor("t1", A());
    expect(p).toMatchObject({ total: 7, notReachable: 3, tooLarge: false, max: MAX_AUDIENCE });
    expect(p.sample).toEqual([{ id: "a", name: "Ada Okafor" }, { id: "b", name: "Chi" }]);
  });

  it("applies each filter", async () => {
    await audienceFor("t1", A({ tagIds: ["g1"], types: ["CUSTOMER"], leadStatuses: ["QUALIFIED"], sources: ["Instagram"], noOrderDays: 90 }), { now: NOW });
    const w = db.contact.count.mock.calls[0][0].where;
    expect(w.tags).toEqual({ some: { tenantId: "t1", tagId: { in: ["g1"] } } });
    expect(w.type).toEqual({ in: ["CUSTOMER"] });
    expect(w.leadStatus).toEqual({ in: ["QUALIFIED"] });
    expect(w.OR).toEqual([{ source: { equals: "Instagram", mode: "insensitive" } }]);
    expect(w.deals.none).toMatchObject({ tenantId: "t1", deletedAt: null, stage: "CLOSED_WON" });
    expect(w.deals.none.createdAt.gte).toEqual(new Date(NOW.getTime() - 90 * 86_400_000));
  });

  it("says when the audience is over the limit", async () => {
    db.contact.count.mockResolvedValue(MAX_AUDIENCE + 1);
    expect((await audienceFor("t1", A())).tooLarge).toBe(true);
  });

  it("asks for the recipients' ids only when wanted, and never more than one over the limit", async () => {
    await audienceFor("t1", A());
    expect(db.contact.findMany.mock.calls[0][0].take).toBe(10);
    await audienceFor("t1", A(), { ids: true });
    expect(db.contact.findMany.mock.calls[1][0].take).toBe(MAX_AUDIENCE + 1);
  });

  it("paid in full: needs a won order, and every won order paid", async () => {
    db.contact.findMany.mockResolvedValue([1, 2, 3, 4].map((n) => ({ id: `c${n}`, firstName: `N${n}`, lastName: "X" })));
    db.contact.count.mockResolvedValue(4);
    db.deal.findMany.mockResolvedValue([
      { id: "d1", contactId: "c1", amount: 100 }, // paid
      { id: "d2", contactId: "c2", amount: 100 }, // part paid
      { id: "d3", contactId: "c2", amount: 50 },
      { id: "d4", contactId: "c3", amount: 80 }, // paid
      // c4 has no won order
    ]);
    db.payment.groupBy.mockResolvedValue([
      { dealId: "d1", _sum: { amount: 100 } },
      { dealId: "d2", _sum: { amount: 100 } },
      { dealId: "d4", _sum: { amount: 80 } },
    ]);
    const p = await audienceFor("t1", A({ paidInFull: true }), { ids: true });
    expect(p.ids).toEqual(["c1", "c3"]);
    expect(p.total).toBe(2);
    expect(db.deal.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", deletedAt: null, stage: "CLOSED_WON" });
    expect(db.payment.groupBy.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("reads a stored filter safely", () => {
    expect(readAudience(undefined)).toEqual(A());
    expect(readAudience({ types: ["NOPE"] })).toEqual(A());
    expect(readAudience({ types: ["CUSTOMER"] }).types).toEqual(["CUSTOMER"]);
  });
});

describe("template check", () => {
  it("accepts the customer's name and typed text, and lines the typed values up with the blanks", async () => {
    const r = await checkCampaignTemplate("t1", "tpl1", ["ignored", "  10% off "]);
    expect(r.values).toEqual(["", "10% off"]);
    expect(db.whatsappTemplate.findFirst.mock.calls[0][0].where).toMatchObject({ id: "tpl1", tenantId: "t1", active: true, status: "APPROVED", supported: true });
  });

  it("refuses a template that is not approved and on", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(null);
    await expect(checkCampaignTemplate("t1", "x", [])).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a blank that depends on one order, and a typed blank left empty", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(template({ slots: [{ label: "Amount", source: "amountDue" }], body: "{{1}}" }));
    await expect(checkCampaignTemplate("t1", "tpl1", [])).rejects.toMatchObject({ status: 422, fieldErrors: { templateId: [expect.stringContaining("Amount")] } });
    db.whatsappTemplate.findFirst.mockResolvedValue(template());
    await expect(checkCampaignTemplate("t1", "tpl1", ["", "  "])).rejects.toMatchObject({ status: 422, fieldErrors: { "values.1": [expect.any(String)] } });
  });
});

describe("campaign routes", () => {
  it("lists campaigns of this business with their outcome counts", async () => {
    db.campaign.findMany.mockResolvedValue([row()]);
    db.campaignRecipient.groupBy.mockResolvedValue([{ campaignId: "c1", status: "SENT", _count: { _all: 4 } }]);
    const res = await json(await list(new Request("https://x.test"), undefined as never));
    expect(res.data[0]).toMatchObject({ id: "c1", templateName: "new_stock", counts: { SENT: 4 } });
    expect(JSON.stringify(db.campaign.findMany.mock.calls[0][0].where)).toContain("t1");
    expect(db.campaignRecipient.groupBy.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("saves a draft and sends nothing", async () => {
    const res = await create(body("POST", { name: " November ", templateId: "tpl1", audience: { types: ["CUSTOMER"] }, values: ["", "10% off"] }), undefined as never);
    expect(res.status).toBe(201);
    const data = db.campaign.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: "t1", name: "November", templateId: "tpl1", createdById: "u1", values: ["", "10% off"] });
    expect(data.audience.types).toEqual(["CUSTOMER"]);
    expect(data).not.toHaveProperty("status");
  });

  it("rejects a bad body or template with 422", async () => {
    expect((await create(body("POST", { templateId: "tpl1" }), undefined as never)).status).toBe(422);
    db.whatsappTemplate.findFirst.mockResolvedValue(null);
    expect((await create(body("POST", { name: "x", templateId: "tpl1" }), undefined as never)).status).toBe(422);
    expect(db.campaign.create).not.toHaveBeenCalled();
  });

  it("404s a campaign of another business, and edits only drafts", async () => {
    db.campaign.findFirst.mockResolvedValue(null);
    expect((await one(new Request("https://x.test"), ctx())).status).toBe(404);
    expect(db.campaign.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", tenantId: "t1" });
    db.campaign.findFirst.mockResolvedValue(row({ status: "SENDING" }));
    expect((await patch(body("PATCH", { name: "New name" }), ctx())).status).toBe(409);
    expect((await del(new Request("https://x.test", { method: "DELETE" }), ctx())).status).toBe(409);
    expect(db.campaign.update).not.toHaveBeenCalled();
    expect(db.campaign.deleteMany).not.toHaveBeenCalled();
  });

  it("edits a draft, re-checking the template with the existing typed values", async () => {
    const res = await patch(body("PATCH", { name: "Renamed" }), ctx());
    expect(res.status).toBe(200);
    expect(db.campaign.update.mock.calls[0][0].data).toMatchObject({ name: "Renamed", templateId: "tpl1", values: ["", "10% off"] });
  });

  it("deletes a draft for good, keeping a snapshot in the audit log first", async () => {
    const res = await del(new Request("https://x.test", { method: "DELETE" }), ctx());
    expect(res.status).toBe(204);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), expect.objectContaining({ action: "campaign.deleted", entityId: "c1", data: expect.objectContaining({ name: "November" }) }), expect.anything());
    expect(db.campaign.deleteMany.mock.calls[0][0].where).toMatchObject({ id: "c1", status: "DRAFT" });
  });

  it("previews an audience from the query, and rejects a broken filter", async () => {
    const q = (a: string) => new Request(`https://x.test/api/admin/campaigns/audience?audience=${encodeURIComponent(a)}`);
    const ok = await json(await preview(q(JSON.stringify({ types: ["CUSTOMER"] })), undefined as never));
    expect(ok.data).toMatchObject({ total: 0, tooLarge: false });
    expect((await preview(q("{nope"), undefined as never)).status).toBe(422);
    expect((await preview(q(JSON.stringify({ types: ["WIZARD"] })), undefined as never)).status).toBe(422);
  });
});

describe("opt-in record", () => {
  it("records the moment and the source when the tick is first set, and clears both when it is withdrawn", () => {
    expect(optInColumns(true, false, "Ticked by staff", NOW)).toEqual({ whatsappOptInAt: NOW, whatsappOptInSource: "Ticked by staff" });
    expect(optInColumns(false, true)).toEqual({ whatsappOptInAt: null, whatsappOptInSource: null });
  });

  it("leaves the record alone when nothing changes", () => {
    expect(optInColumns(true, true)).toEqual({});
    expect(optInColumns(false, false)).toEqual({});
    expect(optInColumns(undefined, true)).toEqual({});
  });
});
