import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, wa, cap, audience, rate } = vi.hoisted(() => ({
  db: {
    campaign: { updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    campaignRecipient: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), createMany: vi.fn() },
    activity: { create: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
  },
  wa: { sendWhatsAppTemplate: vi.fn(), whatsappConfigured: vi.fn() },
  cap: vi.fn(),
  audience: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp")>()), ...wa }));
vi.mock("@/lib/usage-limits", () => ({ assertUnderDailyCap: cap }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: rate }));
vi.mock("@/lib/campaign-audience", async (orig) => ({ ...(await orig<typeof import("@/lib/campaign-audience")>()), audienceFor: audience }));

import { ApiError } from "@/lib/api";
import { WhatsAppSendError } from "@/lib/whatsapp";
import { BATCH_SIZE, MAX_CONSECUTIVE_FAILURES, runCampaignBatch, sweepCampaigns } from "@/lib/campaign-sender";
import { resumeCampaign, sendCampaignTest, startCampaign, stopCampaign } from "@/lib/campaign-actions";

const user = { id: "u1", tenantId: "t1", role: "ADMIN", name: "Ada Okafor", email: "a@x.test" } as Parameters<typeof startCampaign>[0];
const tpl = { id: "tpl1", name: "new_stock", language: "en", category: "MARKETING", body: "Hi {{1}}, {{2}}", status: "APPROVED", supported: true, active: true, slots: [{ label: "First name", source: "firstName" }, { label: "Offer", source: "manual" }] };
const campaign = (over: object = {}) => ({ id: "c1", tenantId: "t1", name: "November", status: "SENDING", templateId: "tpl1", template: tpl, audience: {}, values: ["", "10% off"], createdById: "u1", testedAt: new Date(), ...over });
const rec = (n: number, over: object = {}) => ({ id: `r${n}`, contact: { id: `k${n}`, firstName: `N${n}`, lastName: "Okafor", phoneE164: `+23480000000${n}`, whatsappOptIn: true, deletedAt: null, ...over } });
const updates = () => db.campaignRecipient.updateMany.mock.calls.map((c) => c[0]);
const campaignUpdates = () => db.campaign.updateMany.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  db.campaign.updateMany.mockResolvedValue({ count: 1 });
  db.campaign.findFirst.mockResolvedValue(campaign());
  db.campaignRecipient.updateMany.mockResolvedValue({ count: 1 });
  db.campaignRecipient.count.mockResolvedValue(5);
  db.campaignRecipient.findMany.mockResolvedValue([rec(1), rec(2)]);
  db.activity.create.mockResolvedValue({});
  db.whatsappTemplate.findFirst.mockResolvedValue(tpl);
  wa.whatsappConfigured.mockResolvedValue(true);
  wa.sendWhatsAppTemplate.mockImplementation(async (_t: string, to: string) => `wamid.${to}`);
  cap.mockResolvedValue(undefined);
  rate.mockResolvedValue(undefined);
});

describe("runCampaignBatch", () => {
  it("sends each waiting customer once, with their own name and the typed text, and logs it on their timeline", async () => {
    const r = await runCampaignBatch("t1", "c1");
    expect(r).toMatchObject({ busy: false, sent: 2, failed: 0 });
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledWith("t1", "+234800000001", "new_stock", "en", ["N1", "10% off"]);
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledWith("t1", "+234800000002", "new_stock", "en", ["N2", "10% off"]);
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", type: "WHATSAPP", direction: "OUT", subject: "Campaign: November", body: "Hi N1, 10% off", externalId: "wamid.+234800000001", contactId: "k1", authorId: "u1" });
    expect(db.campaignRecipient.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t1", campaignId: "c1", status: "PENDING" }, take: BATCH_SIZE });
  });

  it("claims each customer before sending, so a second batch can never send to the same one", async () => {
    await runCampaignBatch("t1", "c1");
    const claim = updates()[0];
    expect(claim).toMatchObject({ where: { id: "r1", tenantId: "t1", status: "PENDING" }, data: { status: "SENT" } });
    const claimedAt = db.campaignRecipient.updateMany.mock.invocationCallOrder[0];
    expect(claimedAt).toBeLessThan(wa.sendWhatsAppTemplate.mock.invocationCallOrder[0]);
    // Someone else already took r1: it is not messaged.
    db.campaignRecipient.updateMany.mockResolvedValueOnce({ count: 0 });
    wa.sendWhatsAppTemplate.mockClear();
    await runCampaignBatch("t1", "c1");
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and says so, when another batch holds the lock", async () => {
    db.campaign.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await runCampaignBatch("t1", "c1");
    expect(r.busy).toBe(true);
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("skips, with a reason, a customer who withdrew since the start, was deleted or lost their number", async () => {
    db.campaignRecipient.findMany.mockResolvedValue([rec(1, { whatsappOptIn: false }), rec(2, { deletedAt: new Date() }), rec(3, { phoneE164: null })]);
    const r = await runCampaignBatch("t1", "c1");
    expect(r).toMatchObject({ sent: 0, skipped: 3 });
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(updates().filter((u) => u.data.status === "SKIPPED")).toHaveLength(3);
  });

  it("records a refused message as failed with Meta's reason and carries on", async () => {
    wa.sendWhatsAppTemplate.mockRejectedValueOnce(new WhatsAppSendError("Phone number not on WhatsApp", 400, 131026));
    const r = await runCampaignBatch("t1", "c1");
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(updates()).toContainEqual({ where: { id: "r1", tenantId: "t1" }, data: { status: "FAILED", reason: "Phone number not on WhatsApp" } });
  });

  it("pauses after too many failures in a row", async () => {
    db.campaignRecipient.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, i) => rec(i + 1)));
    wa.sendWhatsAppTemplate.mockRejectedValue(new WhatsAppSendError("Template paused", 400, 132015));
    const r = await runCampaignBatch("t1", "c1");
    expect(r.failed).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
    expect(campaignUpdates().some((u) => u.data.status === "PAUSED" && u.data.pausedReason === "TOO_MANY_FAILURES")).toBe(true);
  });

  it("when Meta says slow down, puts that customer back in the queue and pauses", async () => {
    wa.sendWhatsAppTemplate.mockRejectedValueOnce(new WhatsAppSendError("Rate limit hit", 429, 130429));
    const r = await runCampaignBatch("t1", "c1");
    expect(r.sent).toBe(0);
    expect(updates()).toContainEqual({ where: { id: "r1", tenantId: "t1", status: "SENT", messageId: null }, data: { status: "PENDING", sentAt: null } });
    expect(campaignUpdates().some((u) => u.data.pausedReason === "META_RATE_LIMIT")).toBe(true);
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });

  it("at the plan's daily limit, puts the customer back and pauses until tomorrow", async () => {
    cap.mockRejectedValueOnce(new ApiError(429, "limit", "USAGE_LIMIT"));
    await runCampaignBatch("t1", "c1");
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(updates()).toContainEqual({ where: { id: "r1", tenantId: "t1", status: "SENT", messageId: null }, data: { status: "PENDING", sentAt: null } });
    expect(campaignUpdates().some((u) => u.data.pausedReason === "DAILY_LIMIT")).toBe(true);
  });

  it("pauses without sending when the template is no longer approved and on, or WhatsApp is off", async () => {
    db.campaign.findFirst.mockResolvedValue(campaign({ template: { ...tpl, status: "PAUSED" } }));
    await runCampaignBatch("t1", "c1");
    wa.whatsappConfigured.mockResolvedValue(false);
    db.campaign.findFirst.mockResolvedValue(campaign());
    await runCampaignBatch("t1", "c1");
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(campaignUpdates().filter((u) => u.data.pausedReason === "TEMPLATE_UNAVAILABLE")).toHaveLength(2);
  });

  it("marks the campaign done when nobody is left waiting", async () => {
    db.campaignRecipient.count.mockResolvedValue(0);
    await runCampaignBatch("t1", "c1");
    expect(campaignUpdates().some((u) => u.where.status === "SENDING" && u.data.status === "COMPLETED")).toBe(true);
  });

  it("stops at the deadline instead of overrunning the request", async () => {
    const r = await runCampaignBatch("t1", "c1", { deadline: Date.now() - 1 });
    expect(r.sent).toBe(0);
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("always lets go of the lock", async () => {
    wa.whatsappConfigured.mockRejectedValue(new Error("boom"));
    await expect(runCampaignBatch("t1", "c1")).rejects.toThrow("boom");
    expect(campaignUpdates().at(-1)).toMatchObject({ data: { lockedUntil: null } });
  });
});

describe("sweepCampaigns (the daily safety net)", () => {
  it("wakes campaigns paused by the daily limit and carries on the ones still sending", async () => {
    db.campaign.findFirst.mockResolvedValue(campaign());
    db.campaign.findMany.mockResolvedValue([{ id: "c1" }]);
    db.campaignRecipient.count.mockResolvedValue(0); // nobody left after the first batch
    const r = await sweepCampaigns("t1", Date.now() + 5000);
    expect(db.campaign.updateMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t1", status: "PAUSED", pausedReason: "DAILY_LIMIT" }, data: { status: "SENDING", pausedReason: null } });
    expect(r.campaigns).toBe(1);
    expect(r.sent).toBeGreaterThan(0);
  });
});

describe("sendCampaignTest", () => {
  const draft = () => campaign({ status: "DRAFT", testedAt: null });
  beforeEach(() => db.campaign.findFirst.mockResolvedValue(draft()));

  it("sends the real message to the admin's own number, filled with their name, and marks the draft tested", async () => {
    const r = await sendCampaignTest(user, "c1", "+234 801 234 5678");
    expect(r.sentTo).toBe("+2348012345678");
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledWith("t1", "+2348012345678", "new_stock", "en", ["Ada", "10% off"]);
    expect(db.campaign.updateMany).toHaveBeenCalledWith({ where: { id: "c1", tenantId: "t1", status: "DRAFT" }, data: { testedAt: expect.any(Date) } });
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("refuses a bad number, a campaign that already started, and does not mark it tested when Meta refuses", async () => {
    await expect(sendCampaignTest(user, "c1", "not a number")).rejects.toMatchObject({ status: 422 });
    db.campaign.findFirst.mockResolvedValue(campaign());
    await expect(sendCampaignTest(user, "c1", "+2348012345678")).rejects.toMatchObject({ status: 409 });
    db.campaign.findFirst.mockResolvedValue(draft());
    wa.sendWhatsAppTemplate.mockRejectedValue(new Error("nope"));
    await expect(sendCampaignTest(user, "c1", "+2348012345678")).rejects.toMatchObject({ status: 502 });
    expect(db.campaign.updateMany).not.toHaveBeenCalled();
  });
});

describe("startCampaign", () => {
  const draft = (over: object = {}) => campaign({ status: "DRAFT", ...over });
  beforeEach(() => {
    db.campaign.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.templateId ? null : draft()));
    audience.mockResolvedValue({ total: 3, notReachable: 0, tooLarge: false, max: 2000, sample: [], ids: ["k1", "k2", "k3"] });
  });

  it("starts a tested draft for exactly the audience that was confirmed, putting each customer on the list once", async () => {
    expect(await startCampaign(user, "c1", 3)).toEqual({ audienceSize: 3 });
    expect(db.campaign.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "c1", tenantId: "t1", status: "DRAFT" }, data: { status: "SENDING", audienceSize: 3 } });
    expect(db.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: ["k1", "k2", "k3"].map((contactId) => ({ tenantId: "t1", campaignId: "c1", contactId })),
      skipDuplicates: true,
    });
  });

  it("refuses an untested draft, a changed audience, an empty or oversized one", async () => {
    db.campaign.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.templateId ? null : draft({ testedAt: null })));
    await expect(startCampaign(user, "c1", 3)).rejects.toMatchObject({ code: "NOT_TESTED" });
    db.campaign.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.templateId ? null : draft()));
    await expect(startCampaign(user, "c1", 2)).rejects.toMatchObject({ status: 409, code: "AUDIENCE_CHANGED" });
    audience.mockResolvedValue({ total: 0, tooLarge: false, max: 2000, ids: [] });
    await expect(startCampaign(user, "c1", 0)).rejects.toMatchObject({ code: "EMPTY_AUDIENCE" });
    audience.mockResolvedValue({ total: 2001, tooLarge: true, max: 2000, ids: [] });
    await expect(startCampaign(user, "c1", 2001)).rejects.toMatchObject({ code: "AUDIENCE_TOO_LARGE" });
    expect(db.campaignRecipient.createMany).not.toHaveBeenCalled();
  });

  it("refuses when another campaign is already sending the same template, or this one has started", async () => {
    db.campaign.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.templateId ? { name: "Other" } : draft()));
    await expect(startCampaign(user, "c1", 3)).rejects.toMatchObject({ code: "ALREADY_RUNNING" });
    db.campaign.findFirst.mockResolvedValue(campaign());
    await expect(startCampaign(user, "c1", 3)).rejects.toMatchObject({ code: "NOT_A_DRAFT" });
  });

  it("a double click cannot start it twice", async () => {
    db.campaign.updateMany.mockResolvedValue({ count: 0 });
    await expect(startCampaign(user, "c1", 3)).rejects.toMatchObject({ code: "NOT_A_DRAFT" });
    expect(db.campaignRecipient.createMany).not.toHaveBeenCalled();
  });
});

describe("stop and resume", () => {
  it("stopping skips everyone still waiting and leaves what was sent alone", async () => {
    db.campaignRecipient.updateMany.mockResolvedValue({ count: 7 });
    expect(await stopCampaign(user, "c1")).toEqual({ skipped: 7 });
    expect(db.campaign.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "c1", tenantId: "t1", status: { in: ["SENDING", "PAUSED"] } }, data: { status: "STOPPED" } });
    expect(db.campaignRecipient.updateMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t1", campaignId: "c1", status: "PENDING" }, data: { status: "SKIPPED" } });
  });

  it("cannot stop one that is not running", async () => {
    db.campaign.updateMany.mockResolvedValue({ count: 0 });
    await expect(stopCampaign(user, "c1")).rejects.toMatchObject({ status: 409 });
    expect(db.campaignRecipient.updateMany).not.toHaveBeenCalled();
  });

  it("resumes only a paused campaign, after checking the template again", async () => {
    db.campaign.findFirst.mockResolvedValue(campaign({ status: "PAUSED" }));
    await resumeCampaign(user, "c1");
    expect(db.campaign.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "c1", tenantId: "t1", status: "PAUSED" }, data: { status: "SENDING", pausedReason: null } });
    db.campaign.findFirst.mockResolvedValue(campaign({ status: "SENDING" }));
    await expect(resumeCampaign(user, "c1")).rejects.toMatchObject({ status: 409 });
  });
});
