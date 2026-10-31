import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit } = vi.hoisted(() => ({
  db: {
    contact: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    campaignRecipient: { findMany: vi.fn(), updateMany: vi.fn() },
    activity: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
    automationSetting: { findUnique: vi.fn() },
    tenantIntegration: { findFirst: vi.fn(async () => null) },
  },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/mail", () => ({ trySendMail: vi.fn(async () => true), appUrl: () => "https://crm.test" }));

import { isAutoOptOutWord, optOutByReply } from "@/lib/whatsapp-optout";
import { recordInbound } from "@/lib/whatsapp";
import { campaignReport } from "@/lib/campaign-report";

const AT = new Date("2026-11-20T10:00:00Z");
const H = 3_600_000;

describe("stop words", () => {
  it("takes only a message that is nothing but the word", () => {
    for (const ok of ["STOP", "stop", " Stop. ", "Unsubscribe", "UNSUBSCRIBE!", "cancel", "End", '"stop"']) expect(isAutoOptOutWord(ok), ok).toBe(true);
    for (const no of ["please cancel my order", "stop messaging me", "Don't stop", "end of the month", "stopped by the shop", "", "cancel cancel", "quit"]) expect(isAutoOptOutWord(no), no).toBe(false);
  });
});

describe("optOutByReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.contact.updateMany.mockResolvedValue({ count: 1 });
    db.campaignRecipient.updateMany.mockResolvedValue({ count: 2 });
    db.activity.create.mockResolvedValue({});
  });

  it("withdraws the agreement and its record, drops them from waiting campaigns, and leaves a note and an audit line", async () => {
    expect(await optOutByReply("t1", { id: "c1", whatsappOptIn: true }, "u1", " STOP ")).toBe(true);
    expect(db.contact.updateMany).toHaveBeenCalledWith({ where: { id: "c1", tenantId: "t1", whatsappOptIn: true }, data: { whatsappOptIn: false, whatsappOptInAt: null, whatsappOptInSource: null } });
    expect(db.campaignRecipient.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", contactId: "c1", status: "PENDING" }, data: { status: "SKIPPED", reason: "The customer replied to opt out" } });
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", type: "NOTE", contactId: "c1", authorId: "u1", body: expect.stringContaining("STOP") });
    expect(audit).toHaveBeenCalledWith({ email: "whatsapp-webhook", tenantId: "t1" }, expect.objectContaining({ action: "whatsapp.opt_out", entityId: "c1" }));
  });

  it("does nothing for someone who had not agreed anyway, or when another request got there first", async () => {
    expect(await optOutByReply("t1", { id: "c1", whatsappOptIn: false }, "u1", "STOP")).toBe(false);
    expect(db.contact.updateMany).not.toHaveBeenCalled();
    db.contact.updateMany.mockResolvedValue({ count: 0 });
    expect(await optOutByReply("t1", { id: "c1", whatsappOptIn: true }, "u1", "STOP")).toBe(false);
    expect(db.activity.create).not.toHaveBeenCalled();
  });
});

describe("a STOP reply arriving through the webhook handler", () => {
  const msg = (text: string) => ({ id: "wamid.9", from: "+4915906462275", name: "Ada", text, at: AT });
  beforeEach(() => {
    vi.clearAllMocks();
    db.activity.findFirst.mockResolvedValue(null);
    db.activity.create.mockResolvedValue({});
    db.task.findFirst.mockResolvedValue(null);
    db.contact.updateMany.mockResolvedValue({ count: 1 });
    db.campaignRecipient.updateMany.mockResolvedValue({ count: 0 });
    db.contact.findFirst.mockResolvedValue({ id: "c1", ownerId: "u1", firstName: "Ada", lastName: "Okafor", whatsappOptIn: true });
  });

  it("opts a customer who agreed out, files the message, and makes no reply task", async () => {
    expect(await recordInbound("t1", msg("STOP"))).toBe("recorded");
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ type: "WHATSAPP", direction: "IN", body: "STOP" });
    expect(db.contact.updateMany).toHaveBeenCalled();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("an ordinary message, or STOP from someone who never agreed, still gets the reply task", async () => {
    await recordInbound("t1", msg("What is the price for 24 inch?"));
    expect(db.contact.updateMany).not.toHaveBeenCalled();
    expect(db.task.create).toHaveBeenCalledTimes(1);
    db.activity.findFirst.mockResolvedValue(null);
    db.contact.findFirst.mockResolvedValue({ id: "c1", ownerId: "u1", firstName: "Ada", lastName: "Okafor", whatsappOptIn: false });
    await recordInbound("t1", { ...msg("STOP"), id: "wamid.10" });
    expect(db.task.create).toHaveBeenCalledTimes(2);
  });

  it("still files the message if the opt-out itself fails", async () => {
    db.contact.updateMany.mockRejectedValue(new Error("db down"));
    expect(await recordInbound("t1", msg("STOP"))).toBe("recorded");
    expect(db.task.create).toHaveBeenCalledTimes(1);
  });
});

describe("campaignReport", () => {
  const r = (n: number, over: object = {}) => ({ status: "SENT", reason: null, messageId: `m${n}`, contactId: `k${n}`, sentAt: AT, ...over });

  beforeEach(() => {
    vi.clearAllMocks();
    db.campaignRecipient.findMany.mockResolvedValue([
      r(1), r(2), r(3), r(4),
      r(5, { status: "FAILED", reason: "Phone number not on WhatsApp", messageId: null, sentAt: null }),
      r(6, { status: "SKIPPED", reason: "The customer replied to opt out", messageId: null, sentAt: null }),
      r(7, { status: "PENDING", messageId: null, sentAt: null }),
    ]);
    db.activity.findMany.mockImplementation(async ({ where }: { where: { direction: string } }) =>
      where.direction === "OUT"
        ? [{ deliveryStatus: "READ", deliveryError: null }, { deliveryStatus: "DELIVERED", deliveryError: null }, { deliveryStatus: "FAILED", deliveryError: "Message undeliverable" }, { deliveryStatus: null, deliveryError: null }]
        : [
            { contactId: "k1", occurredAt: new Date(AT.getTime() + 2 * H) }, // inside 48 hours
            { contactId: "k2", occurredAt: new Date(AT.getTime() + 49 * H) }, // too late
            { contactId: "k1", occurredAt: new Date(AT.getTime() + 5 * H) }, // same customer twice counts once
            { contactId: "k3", occurredAt: new Date(AT.getTime() - H) }, // before we wrote
          ],
    );
  });

  it("counts what was sent, delivered, read, failed and answered, and says why", async () => {
    const rep = await campaignReport("t1", "c1");
    expect(rep).toMatchObject({ total: 7, sent: 4, delivered: 2, read: 1, failed: 1, deliveryFailed: 1, skipped: 1, waiting: 1, replies: 1, optedOut: 1 });
    expect(rep.reasons).toEqual(
      expect.arrayContaining([
        { kind: "failed", reason: "Phone number not on WhatsApp", count: 1 },
        { kind: "not delivered", reason: "Message undeliverable", count: 1 },
        { kind: "skipped", reason: "The customer replied to opt out", count: 1 },
      ]),
    );
  });

  it("looks only in this business", async () => {
    await campaignReport("t1", "c1");
    expect(db.campaignRecipient.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", campaignId: "c1" });
    for (const c of db.activity.findMany.mock.calls) expect(c[0].where.tenantId).toBe("t1");
  });
});
