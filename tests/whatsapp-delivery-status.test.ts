import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    activity: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    tenantIntegration: { findFirst: vi.fn(async () => null) }, // no saved settings: the original business uses the environment
  },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/mail", () => ({ trySendMail: vi.fn(async () => true), appUrl: () => "https://crm.test" }));

import { POST as webhook } from "@/app/api/webhooks/whatsapp/route";
import { parseStatuses, recordDeliveryStatus } from "@/lib/whatsapp";

const SECRET = "app-secret";
const statuses = (...list: object[]) => ({ entry: [{ changes: [{ value: { statuses: list } }] }] });
const hook = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body);
  const sig = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  return webhook(new Request("http://crm.test/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signature ?? sig }, body: raw }));
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: "verify-token-123456" });
  db.activity.updateMany.mockResolvedValue({ count: 1 });
});

describe("parseStatuses", () => {
  it("reads sent, delivered, read and failed, and ignores the rest", () => {
    const out = parseStatuses(
      statuses(
        { id: "w1", status: "sent" },
        { id: "w2", status: "delivered" },
        { id: "w3", status: "read" },
        { id: "w4", status: "failed", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Recipient is not a WhatsApp user" } }] },
        { id: "w5", status: "deleted" },
        { status: "read" },
      ),
    );
    expect(out).toEqual([
      { messageId: "w1", status: "SENT", error: null },
      { messageId: "w2", status: "DELIVERED", error: null },
      { messageId: "w3", status: "READ", error: null },
      { messageId: "w4", status: "FAILED", error: "Message undeliverable: Recipient is not a WhatsApp user" },
    ]);
  });

  it("gives a plain reason when Meta sends none, and tolerates junk", () => {
    expect(parseStatuses(statuses({ id: "w1", status: "failed" }))[0].error).toBe("WhatsApp could not deliver the message");
    expect(parseStatuses(null)).toEqual([]);
    expect(parseStatuses({ entry: [{}] })).toEqual([]);
  });
});

describe("recordDeliveryStatus", () => {
  const where = (call = 0) => db.activity.updateMany.mock.calls[call][0].where;

  it("only touches this business's outgoing message with that id", async () => {
    await recordDeliveryStatus("t1", { messageId: "w1", status: "DELIVERED", error: null });
    expect(where()).toMatchObject({ tenantId: "t1", externalId: "w1", direction: "OUT" });
    expect(db.activity.updateMany.mock.calls[0][0].data).toEqual({ deliveryStatus: "DELIVERED", deliveryError: null });
  });

  it("moves forward only: read may replace sent or delivered, delivered may not replace read", async () => {
    await recordDeliveryStatus("t1", { messageId: "w1", status: "READ", error: null });
    expect(where().OR).toEqual([{ deliveryStatus: null }, { deliveryStatus: { in: ["SENT", "DELIVERED"] } }]);
    await recordDeliveryStatus("t1", { messageId: "w1", status: "DELIVERED", error: null });
    expect(where(1).OR).toEqual([{ deliveryStatus: null }, { deliveryStatus: { in: ["SENT"] } }]);
    await recordDeliveryStatus("t1", { messageId: "w1", status: "SENT", error: null });
    expect(where(2).OR).toEqual([{ deliveryStatus: null }, { deliveryStatus: { in: [] } }]);
  });

  it("a failure does not overwrite a message already delivered or read", async () => {
    await recordDeliveryStatus("t1", { messageId: "w1", status: "FAILED", error: "x" });
    expect(where().OR).toEqual([{ deliveryStatus: null }, { deliveryStatus: { in: ["SENT"] } }]);
  });

  it("reports whether a message was found; an unknown id is not an error", async () => {
    db.activity.updateMany.mockResolvedValue({ count: 0 });
    expect(await recordDeliveryStatus("t1", { messageId: "unknown", status: "READ", error: null })).toBe(false);
  });
});

describe("webhook", () => {
  it("records delivery updates from a correctly signed call", async () => {
    const res = await hook(statuses({ id: "w1", status: "read" }, { id: "w2", status: "failed", errors: [{ title: "Undeliverable" }] }));
    expect(res.status).toBe(200);
    expect(db.activity.updateMany).toHaveBeenCalledTimes(2);
    expect(db.activity.updateMany.mock.calls[1][0].data).toEqual({ deliveryStatus: "FAILED", deliveryError: "Undeliverable" });
  });

  it("ignores a call with a bad signature", async () => {
    const res = await hook(statuses({ id: "w1", status: "read" }), "sha256=00");
    expect(res.status).toBe(401);
    expect(db.activity.updateMany).not.toHaveBeenCalled();
  });

  it("answers 500 so Meta retries when the update cannot be saved", async () => {
    db.activity.updateMany.mockRejectedValue(new Error("db down"));
    expect((await hook(statuses({ id: "w1", status: "read" }))).status).toBe(500);
  });
});
