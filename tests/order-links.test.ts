import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, platformDb } = vi.hoisted(() => {
  const db = {
    deal: { findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
    customerOrderLink: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  return { db, platformDb: { customerOrderLink: { findUnique: vi.fn() } } };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/platform-db", () => ({ platformDb }));
vi.mock("@/lib/tenant-context", () => ({ withTenant: async (_t: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test" }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", email: "s@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number; code?: string };
      return new Response(JSON.stringify({ code: err.code }), { status: err.status ?? 500 });
    }
  },
}));

import { DELETE, GET, POST } from "@/app/api/deals/[id]/customer-link/route";
import { createOrderLink, currentOrderLink, DEFAULT_LINK_DAYS, recordOrderLinkView, reminderOrderLink, resolveOrderLink, revokeOrderLink } from "@/lib/order-links";

const NOW = new Date("2026-11-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const user = { id: "u1", tenantId: "t1" };

/** What the database would hold after createOrderLink, so later calls can be checked against the real sealed token. */
let stored: { tokenHash: string; tokenSealed: string; expiresAt: Date };
const row = (over: object = {}) => ({ id: "L1", ...stored, revokedAt: null, lastViewedAt: null, viewCount: 0, createdAt: NOW, ...over });

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.customerOrderLink.create.mockImplementation(async ({ data }) => {
    stored = { tokenHash: data.tokenHash, tokenSealed: data.tokenSealed, expiresAt: data.expiresAt };
    return row({ createdAt: NOW });
  });
  db.customerOrderLink.updateMany.mockResolvedValue({ count: 1 });
  db.deal.findFirst.mockResolvedValue({ id: "d1" });
  db.tenant.findFirst.mockResolvedValue({ id: "t1" });
});

/** Makes one link and returns its token (the last part of the address). */
async function made(days?: number) {
  const dto = await createOrderLink(user, "d1", days, NOW);
  return { dto, token: dto.url!.split("/").pop()! };
}

describe("making a link", () => {
  it("stores only a hash and an encrypted copy, never the token itself", async () => {
    const { token } = await made();
    const data = db.customerOrderLink.create.mock.calls[0][0].data;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.tokenHash).toBe(sha(token));
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data.tokenSealed).not.toContain(token);
  });

  it("gives the address on the configured site, never one taken from a request", async () => {
    const { dto, token } = await made();
    expect(dto.url).toBe(`https://crm.test/my-order/${token}`);
  });

  it("lasts 90 days by default, or as long as asked", async () => {
    await made();
    expect(stored.expiresAt.getTime() - NOW.getTime()).toBe(DEFAULT_LINK_DAYS * DAY);
    await made(7);
    expect(stored.expiresAt.getTime() - NOW.getTime()).toBe(7 * DAY);
  });

  it("revokes the order's earlier links first, inside the same transaction, scoped to the business", async () => {
    await made();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.customerOrderLink.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", dealId: "d1", revokedAt: null }, data: { revokedAt: NOW } });
    expect(db.customerOrderLink.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.customerOrderLink.create.mock.invocationCallOrder[0]);
    expect(db.customerOrderLink.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", dealId: "d1", createdById: "u1" });
  });

  it("makes a different token every time", async () => {
    const a = (await made()).token;
    const b = (await made()).token;
    expect(a).not.toBe(b);
  });
});

describe("showing the current link", () => {
  it("returns null when the order never had one", async () => {
    db.customerOrderLink.findFirst.mockResolvedValue(null);
    expect(await currentOrderLink("t1", "d1", NOW)).toBeNull();
    expect(db.customerOrderLink.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", dealId: "d1" });
  });

  it("shows the same address again while the link is live", async () => {
    const { token } = await made();
    db.customerOrderLink.findFirst.mockResolvedValue(row());
    expect(await currentOrderLink("t1", "d1", NOW)).toMatchObject({ status: "ACTIVE", url: `https://crm.test/my-order/${token}` });
  });

  it("hands out no address for an expired or revoked link", async () => {
    await made();
    db.customerOrderLink.findFirst.mockResolvedValue(row());
    expect(await currentOrderLink("t1", "d1", new Date(stored.expiresAt.getTime() + 1))).toMatchObject({ status: "EXPIRED", url: null });
    db.customerOrderLink.findFirst.mockResolvedValue(row({ revokedAt: NOW }));
    expect(await currentOrderLink("t1", "d1", NOW)).toMatchObject({ status: "REVOKED", url: null });
  });

  it("copes with a stored copy that can no longer be decrypted", async () => {
    await made();
    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64"); // the key was changed
    db.customerOrderLink.findFirst.mockResolvedValue(row());
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await currentOrderLink("t1", "d1", NOW)).toMatchObject({ status: "ACTIVE", url: null });
    spy.mockRestore();
  });
});

describe("opening a link", () => {
  it("finds the business and order for a live token, by hash", async () => {
    const { token } = await made();
    platformDb.customerOrderLink.findUnique.mockResolvedValue({ id: "L1", tenantId: "t1", dealId: "d1", expiresAt: stored.expiresAt, revokedAt: null });
    expect(await resolveOrderLink(token, NOW)).toEqual({ linkId: "L1", tenantId: "t1", dealId: "d1" });
    expect(platformDb.customerOrderLink.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: sha(token) });
  });

  it("refuses junk without touching the database", async () => {
    for (const bad of ["", "abc", "x".repeat(42), "x".repeat(44), "!".repeat(43), "../../etc/passwd", " ".repeat(43)]) {
      expect(await resolveOrderLink(bad, NOW)).toBeNull();
    }
    expect(platformDb.customerOrderLink.findUnique).not.toHaveBeenCalled();
  });

  it("refuses an unknown token", async () => {
    platformDb.customerOrderLink.findUnique.mockResolvedValue(null);
    expect(await resolveOrderLink("A".repeat(43), NOW)).toBeNull();
  });

  it("refuses a revoked link", async () => {
    const { token } = await made();
    platformDb.customerOrderLink.findUnique.mockResolvedValue({ id: "L1", tenantId: "t1", dealId: "d1", expiresAt: stored.expiresAt, revokedAt: NOW });
    expect(await resolveOrderLink(token, NOW)).toBeNull();
  });

  it("refuses an expired link, even one second after", async () => {
    const { token } = await made(1);
    platformDb.customerOrderLink.findUnique.mockResolvedValue({ id: "L1", tenantId: "t1", dealId: "d1", expiresAt: stored.expiresAt, revokedAt: null });
    expect(await resolveOrderLink(token, new Date(stored.expiresAt.getTime() - 1000))).not.toBeNull();
    expect(await resolveOrderLink(token, stored.expiresAt)).toBeNull();
    expect(await resolveOrderLink(token, new Date(stored.expiresAt.getTime() + 1000))).toBeNull();
  });

  it("refuses when the order was deleted or the business is suspended", async () => {
    const { token } = await made();
    platformDb.customerOrderLink.findUnique.mockResolvedValue({ id: "L1", tenantId: "t1", dealId: "d1", expiresAt: stored.expiresAt, revokedAt: null });
    db.deal.findFirst.mockResolvedValue(null);
    expect(await resolveOrderLink(token, NOW)).toBeNull();
    db.deal.findFirst.mockResolvedValue({ id: "d1" });
    db.tenant.findFirst.mockResolvedValue(null);
    expect(await resolveOrderLink(token, NOW)).toBeNull();
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", tenantId: "t1", deletedAt: null });
    expect(db.tenant.findFirst.mock.calls[0][0].where).toMatchObject({ id: "t1", status: "ACTIVE" });
  });

  it("counts a visit for that business only, and never throws", async () => {
    await recordOrderLinkView("t1", "L1", NOW);
    expect(db.customerOrderLink.updateMany).toHaveBeenCalledWith({ where: { id: "L1", tenantId: "t1" }, data: { lastViewedAt: NOW, viewCount: { increment: 1 } } });
    db.customerOrderLink.updateMany.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordOrderLinkView("t1", "L1", NOW)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("switching a link off", () => {
  it("revokes live links of that order in that business and says whether there was one", async () => {
    expect(await revokeOrderLink("t1", "d1", NOW)).toBe(true);
    expect(db.customerOrderLink.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", dealId: "d1", revokedAt: null }, data: { revokedAt: NOW } });
    db.customerOrderLink.updateMany.mockResolvedValue({ count: 0 });
    expect(await revokeOrderLink("t1", "d1", NOW)).toBe(false);
  });

  it("a revoked token no longer opens the order", async () => {
    const { token } = await made();
    // Before: the row is live. After DELETE: the row carries revokedAt, as the update above sets it.
    platformDb.customerOrderLink.findUnique.mockResolvedValue({ id: "L1", tenantId: "t1", dealId: "d1", expiresAt: stored.expiresAt, revokedAt: null });
    expect(await resolveOrderLink(token, NOW)).not.toBeNull();
    await revokeOrderLink("t1", "d1", NOW);
    platformDb.customerOrderLink.findUnique.mockResolvedValue({ id: "L1", tenantId: "t1", dealId: "d1", expiresAt: stored.expiresAt, revokedAt: NOW });
    expect(await resolveOrderLink(token, NOW)).toBeNull();
  });
});

describe("routes", () => {
  const ctx = { params: Promise.resolve({ id: "d1" }) };
  const post = (body: unknown) => POST(new Request("http://x.test/api/deals/d1/customer-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);
  const json = async (res: Response) => (await res.json()) as { data?: { link: { status: string; url: string | null } | null }; code?: string };

  it("look the order up within what the caller may see, and answer 404 otherwise without making anything", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    expect((await GET(new Request("http://x.test"), ctx)).status).toBe(404);
    expect((await post({})).status).toBe(404);
    expect((await DELETE(new Request("http://x.test", { method: "DELETE" }), ctx)).status).toBe(404);
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", deletedAt: null });
    expect(db.customerOrderLink.create).not.toHaveBeenCalled();
    expect(db.customerOrderLink.updateMany).not.toHaveBeenCalled();
  });

  it("POST makes a link and returns its address", async () => {
    const res = await post({ expiresInDays: 30 });
    expect(res.status).toBe(201);
    expect((await json(res)).data?.link).toMatchObject({ status: "ACTIVE", url: expect.stringMatching(/^https:\/\/crm\.test\/my-order\/[\w-]{43}$/) });
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
  });

  it("POST refuses a silly lifetime", async () => {
    for (const expiresInDays of [0, -1, 366, 1.5, "30"]) expect((await post({ expiresInDays })).status).toBe(422);
    expect(db.customerOrderLink.create).not.toHaveBeenCalled();
  });

  it("GET says null when there is no link", async () => {
    db.customerOrderLink.findFirst.mockResolvedValue(null);
    expect((await json(await GET(new Request("http://x.test"), ctx))).data).toEqual({ link: null });
  });

  it("DELETE switches the link off and reports it as revoked", async () => {
    await made();
    db.customerOrderLink.findFirst.mockResolvedValue(row({ revokedAt: NOW }));
    const res = await DELETE(new Request("http://x.test", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect((await json(res)).data?.link).toMatchObject({ status: "REVOKED", url: null });
  });
});

describe("the link a reminder carries", () => {
  it("reuses the live link, so a reminder never kills the one the customer already has", async () => {
    const { dto } = await made();
    db.customerOrderLink.findFirst.mockResolvedValue(row());
    db.customerOrderLink.create.mockClear();
    expect(await reminderOrderLink(user, "d1", NOW)).toBe(dto.url);
    expect(db.customerOrderLink.create).not.toHaveBeenCalled();
  });

  it("makes a link when the order has none, or only a closed one", async () => {
    db.customerOrderLink.findFirst.mockResolvedValue(null);
    expect(await reminderOrderLink(user, "d1", NOW)).toMatch(/^https:\/\/crm\.test\/my-order\/[A-Za-z0-9_-]{43}$/);
    await made();
    db.customerOrderLink.findFirst.mockResolvedValue(row({ revokedAt: NOW }));
    db.customerOrderLink.create.mockClear();
    expect(await reminderOrderLink(user, "d1", NOW)).toMatch(/\/my-order\//);
    expect(db.customerOrderLink.create).toHaveBeenCalledTimes(1);
  });

  it("returns null instead of throwing when the database fails", async () => {
    db.customerOrderLink.findFirst.mockRejectedValue(new Error("db down"));
    expect(await reminderOrderLink(user, "d1", NOW)).toBeNull();
  });
});
