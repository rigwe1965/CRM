import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, consoleOnly, limit } = vi.hoisted(() => ({ send: vi.fn(), consoleOnly: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} })); // the route must not touch the database
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request) => {
    try {
      return await handler({ req, user: { id: "u1", role: "ADMIN", email: "boss@shop.test", name: "Boss" }, params: {} });
    } catch (e) {
      const err = e as { status?: number; code?: string };
      return new Response(JSON.stringify({ code: err.code }), { status: err.status ?? 500 });
    }
  },
}));
vi.mock("@/lib/mail", async (orig) => ({ ...(await orig<typeof import("@/lib/mail")>()), trySendMail: send, mailIsConsoleOnly: consoleOnly }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: limit }));

import { POST } from "@/app/api/admin/automations/sample-email/route";

const call = (body: unknown) =>
  POST(new Request("http://x.test/api/admin/automations/sample-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({}) });
const valid = { to: "me@example.com", brandName: "Ivycandy Hair", kind: "OVERDUE_2" };

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue(true);
  consoleOnly.mockReturnValue(false);
});

describe("POST /api/admin/automations/sample-email", () => {
  it("sends one clearly marked sample with made-up details to the given address", async () => {
    const res = await call(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { to: "me@example.com", consoleOnly: false } });
    expect(send).toHaveBeenCalledOnce();
    const mail = send.mock.calls[0][0];
    expect(mail).toMatchObject({ to: "me@example.com", replyTo: "boss@shop.test", from: expect.stringContaining('"Ivycandy Hair"') });
    expect(mail.subject).toBe("[SAMPLE] Second reminder: $100.00 is overdue");
    expect(mail.text).toContain("made-up details");
    expect(mail.text).toContain("7 days overdue");
    expect(mail.text).toContain("Sample order");
  });

  it("dates each sample like the real notice", async () => {
    await call({ ...valid, kind: "UPCOMING" });
    await call({ ...valid, kind: "OVERDUE_1" });
    expect(send.mock.calls[0][0].subject).toMatch(/^\[SAMPLE\] Payment reminder: \$100\.00 due \d{4}-\d{2}-\d{2}$/);
    expect(send.mock.calls[1][0].subject).toMatch(/^\[SAMPLE\] Your payment of \$100\.00 was due on /);
  });

  it("tells the admin when nothing was really delivered because no email provider is set up", async () => {
    consoleOnly.mockReturnValue(true);
    expect(await (await call(valid)).json()).toEqual({ data: { to: "me@example.com", consoleOnly: true } });
  });

  it("rejects a bad address, a missing sender name or an unknown kind without sending", async () => {
    for (const bad of [{ ...valid, to: "not an email" }, { ...valid, brandName: " " }, { ...valid, kind: "SOMETHING" }, {}]) {
      expect((await call(bad)).status).toBe(422);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a provider failure and is rate limited per user", async () => {
    send.mockResolvedValue(false);
    const res = await call(valid);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("EMAIL_FAILED");
    expect(limit).toHaveBeenCalledWith("sample-email:u1", expect.objectContaining({ max: expect.any(Number) }));
  });
});
