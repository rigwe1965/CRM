import { beforeEach, describe, expect, it, vi } from "vitest";

const { holder, run, props, db, after, keep } = vi.hoisted(() => ({
  holder: { user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", tenantWritable: true } as Record<string, unknown> },
  run: { inboxAvailability: vi.fn(), runToday: vi.fn(), runInboxForUser: vi.fn() },
  props: { listInbox: vi.fn() },
  db: { user: { updateMany: vi.fn() } },
  after: vi.fn(),
  keep: vi.fn(),
}));

vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: holder.user, params: await context?.params });
    } catch (e) {
      const { toErrorResponse } = await import("@/lib/api");
      return toErrorResponse(e);
    }
  },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after }));
vi.mock("@/lib/tenant-context", () => ({ keepTenant: keep }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/inbox/run", () => run);
vi.mock("@/lib/ai/proposals", () => props);

import * as list from "@/app/api/assistant/inbox/route";
import * as refresh from "@/app/api/assistant/inbox/refresh/route";
import * as mute from "@/app/api/assistant/inbox/mute/route";
import { allowedWhenReadOnly } from "@/lib/plans";

type H = (req: Request) => Promise<Response>;
const get = async () => (await (list.GET as unknown as H)(new Request("http://x.test/api/assistant/inbox"))).json();
const post = () => (refresh.POST as unknown as H)(new Request("http://x.test/api/assistant/inbox/refresh", { method: "POST", body: "{}" }));
const put = (body: unknown) => (mute.PUT as unknown as H)(new Request("http://x.test/api/assistant/inbox/mute", { method: "PUT", body: JSON.stringify(body) }));
const card = (status: string) => ({ id: "p-" + status, status, preview: { title: "t", lines: [] } });

beforeEach(() => {
  vi.resetAllMocks();
  holder.user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", tenantWritable: true };
  keep.mockReturnValue((fn: () => Promise<unknown>) => fn());
  run.inboxAvailability.mockResolvedValue("ok");
  run.runToday.mockResolvedValue(null);
  props.listInbox.mockResolvedValue([]);
});

describe("GET /api/assistant/inbox", () => {
  it("answers at once, with nothing read, when the inbox is off", async () => {
    run.inboxAvailability.mockResolvedValue("disabled");
    expect((await get()).data).toEqual({ available: "disabled", ranToday: false, running: false, pending: 0, items: [] });
    expect(props.listInbox).not.toHaveBeenCalled();
  });

  it("gives this person's own cards, how many wait, and whether today's run is made or running", async () => {
    props.listInbox.mockResolvedValue([card("PENDING"), card("PENDING"), card("APPLIED")]);
    run.runToday.mockResolvedValue({ status: "DONE", created: 3, startedAt: new Date() });
    const d = (await get()).data;
    expect(d).toMatchObject({ available: "ok", ranToday: true, running: false, pending: 2 });
    expect(d.items).toHaveLength(3);
    expect(props.listInbox).toHaveBeenCalledWith(holder.user);
    run.runToday.mockResolvedValue({ status: "RUNNING", created: 0, startedAt: new Date() });
    expect((await get()).data).toMatchObject({ ranToday: true, running: true });
    run.runToday.mockResolvedValue({ status: "FAILED", created: 0, startedAt: new Date() });
    expect((await get()).data.ranToday).toBe(false);
  });

  it("still lists what is waiting for someone who has muted the suggestions", async () => {
    run.inboxAvailability.mockResolvedValue("muted");
    props.listInbox.mockResolvedValue([card("PENDING")]);
    expect((await get()).data).toMatchObject({ available: "muted", pending: 1 });
  });
});

describe("POST /api/assistant/inbox/refresh", () => {
  it("starts today's run after answering, as the signed-in person, inside their business", async () => {
    const res = await post();
    expect((await res.json()).data).toEqual({ status: "started" });
    expect(after).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(run.runInboxForUser).not.toHaveBeenCalled(); // not yet: it runs after the response
    run.runInboxForUser.mockResolvedValue({ status: "done", created: 2 });
    await after.mock.calls[0][0]();
    expect(run.runInboxForUser).toHaveBeenCalledWith(holder.user);
  });

  it("does not start twice: done and running runs answer straight away", async () => {
    run.runToday.mockResolvedValue({ status: "DONE", created: 2, startedAt: new Date() });
    expect((await (await post()).json()).data.status).toBe("already");
    run.runToday.mockResolvedValue({ status: "RUNNING", created: 0, startedAt: new Date() });
    expect((await (await post()).json()).data.status).toBe("running");
    expect(after).not.toHaveBeenCalled();
  });

  it("starts again for a failed run, or one that has been running far too long", async () => {
    run.runToday.mockResolvedValue({ status: "FAILED", created: 0, startedAt: new Date() });
    expect((await (await post()).json()).data.status).toBe("started");
    run.runToday.mockResolvedValue({ status: "RUNNING", created: 0, startedAt: new Date(Date.now() - 20 * 60_000) });
    expect((await (await post()).json()).data.status).toBe("started");
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("starts nothing when the inbox is off, muted, or the workspace is read-only", async () => {
    for (const s of ["disabled", "muted", "read_only"]) {
      run.inboxAvailability.mockResolvedValue(s);
      expect((await (await post()).json()).data.status).toBe(s);
    }
    expect(after).not.toHaveBeenCalled();
  });

  it("a background failure is logged, never thrown", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    run.runInboxForUser.mockRejectedValue(new Error("boom"));
    await post();
    await expect(after.mock.calls[0][0]()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("PUT /api/assistant/inbox/mute", () => {
  it("mutes or unmutes the signed-in person only, in their business", async () => {
    expect((await (await put({ muted: true })).json()).data).toEqual({ muted: true });
    expect(db.user.updateMany).toHaveBeenCalledWith({ where: { id: "u1", tenantId: "t1" }, data: { aiSuggestionsMuted: true } });
    await put({ muted: false });
    expect(db.user.updateMany.mock.calls[1][0].data).toEqual({ aiSuggestionsMuted: false });
  });

  it("refuses anything but a yes or no", async () => {
    expect((await put({ muted: "yes" })).status).toBe(422);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("read-only workspaces", () => {
  it("can still see and mute the suggestions list; the run itself refuses (read_only)", () => {
    expect(allowedWhenReadOnly("/api/assistant/inbox")).toBe(true);
    expect(allowedWhenReadOnly("/api/assistant/inbox/refresh")).toBe(true);
    expect(allowedWhenReadOnly("/api/assistant/inbox/mute")).toBe(true);
  });
});
