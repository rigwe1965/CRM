import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { record, triage, after, tenantRun } = vi.hoisted(() => ({
  record: vi.fn(),
  triage: { enqueueTriage: vi.fn(), processTriage: vi.fn() },
  after: vi.fn(),
  tenantRun: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after }));
vi.mock("@/lib/integrations", () => ({ getIntegration: vi.fn(async () => ({ settings: { appSecret: "s3cret", verifyToken: "tok" } })) }));
vi.mock("@/lib/tenant-context", () => ({ withTenant: (id: string, fn: () => unknown) => (tenantRun(id), fn()) }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp")>()), recordInbound: record }));
vi.mock("@/lib/ai/triage/run", () => triage);

import { receiveWhatsappWebhook } from "@/lib/whatsapp-webhook";

const body = (...ids: string[]) =>
  JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "2348011111111" }], messages: ids.map((id) => ({ id, from: "2348011111111", timestamp: "1790000000", type: "text", text: { body: "hello" } })) } }] }] });
const call = (raw: string) => receiveWhatsappWebhook(new Request("http://x.test", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}` }, body: raw }), "t1");

beforeEach(() => {
  vi.resetAllMocks();
  record.mockResolvedValue("recorded");
  triage.enqueueTriage.mockResolvedValue([]);
  triage.processTriage.mockResolvedValue(undefined);
});

describe("the WhatsApp webhook and triage", () => {
  it("queues only the messages it newly filed, inside the business, and triages them after answering Meta", async () => {
    record.mockResolvedValueOnce("recorded").mockResolvedValueOnce("duplicate");
    triage.enqueueTriage.mockResolvedValue(["act1"]);
    const res = await call(body("m1", "m2"));
    expect(res.status).toBe(200);
    expect(triage.enqueueTriage).toHaveBeenCalledWith("t1", ["m1"]);
    expect(after).toHaveBeenCalledTimes(1);
    expect(triage.processTriage).not.toHaveBeenCalled(); // not yet: it runs after the response
    await after.mock.calls[0][0]();
    expect(triage.processTriage).toHaveBeenCalledWith("t1", ["act1"]);
    expect(tenantRun).toHaveBeenCalledWith("t1");
  });

  it("a repeat delivery from Meta queues and triages nothing", async () => {
    record.mockResolvedValue("duplicate");
    expect((await call(body("m1"))).status).toBe(200);
    expect(triage.enqueueTriage).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("does nothing extra when triage is off (nothing is queued)", async () => {
    expect((await call(body("m1"))).status).toBe(200);
    expect(triage.enqueueTriage).toHaveBeenCalledWith("t1", ["m1"]);
    expect(after).not.toHaveBeenCalled();
  });

  it("still answers 200 when triage cannot be queued: the message is filed and the owner has the reply task", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    triage.enqueueTriage.mockRejectedValue(new Error("db hiccup"));
    expect((await call(body("m1"))).status).toBe(200);
    expect(after).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a failure in the background run is logged and never thrown", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    triage.enqueueTriage.mockResolvedValue(["act1"]);
    triage.processTriage.mockRejectedValue(new Error("boom"));
    await call(body("m1"));
    await expect(Promise.resolve(after.mock.calls[0][0]())).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("does not queue anything when filing the message fails, so Meta tries again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    record.mockRejectedValue(new Error("db down"));
    expect((await call(body("m1"))).status).toBe(500);
    expect(triage.enqueueTriage).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
