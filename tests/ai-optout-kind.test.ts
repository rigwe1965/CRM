import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { contact: { findFirst: vi.fn(), updateMany: vi.fn() }, aiProposal: { findMany: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/crm-actions", () => ({ changeDealStage: vi.fn(), createContact: vi.fn(), createDeal: vi.fn(), createTask: vi.fn(), logActivity: vi.fn(), updateTask: vi.fn() }));
vi.mock("@/lib/record-payment", () => ({ recordPayment: vi.fn() }));
vi.mock("@/lib/replace-schedule", () => ({ replaceSchedule: vi.fn(), scheduleKey: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ loadAssistantSettings: vi.fn() }));

import { ToolError } from "@/lib/ai/tools/types";
import { KINDS } from "@/lib/ai/proposal-kinds";
import { listInbox, toDto } from "@/lib/ai/proposals";

const sales = { id: "u-sales", tenantId: "t1", role: "SALES", name: "Sam" } as never;
const admin = { id: "u-admin", tenantId: "t1", role: "ADMIN", name: "Ada" } as never;
const prepare = (raw: unknown, user = sales) => (KINDS.CONTACT_OPT_OUT.prepare as unknown as (u: never, r: unknown) => Promise<{ params: Record<string, unknown>; preview: { title: string; lines: { label: string; value: string }[]; warning?: string } }>)(user, raw);
const apply = (params: Record<string, unknown>, user = sales) => KINDS.CONTACT_OPT_OUT.apply!(user, params);

beforeEach(() => {
  vi.resetAllMocks();
  db.contact.findFirst.mockResolvedValue({ firstName: "Adaeze", lastName: "Okafor", whatsappOptIn: true });
  db.contact.updateMany.mockResolvedValue({ count: 1 });
});

describe("CONTACT_OPT_OUT", () => {
  it("builds the card from the saved contact, in the person's own scope, and says what will change", async () => {
    const out = await prepare({ contactId: "c1" });
    expect(out.params).toEqual({ contactId: "c1" });
    expect(out.preview.lines).toEqual([{ label: "Customer", value: "Adaeze Okafor" }, { label: "Change", value: "Mark as not agreeing to WhatsApp messages" }]);
    expect(out.preview.warning).toMatch(/no longer be sent to them on WhatsApp/);
    expect(JSON.stringify(db.contact.findFirst.mock.calls[0][0].where)).toContain('"ownerId":"u-sales"');
  });

  it("refuses a contact that is not visible to the person, or is already opted out", async () => {
    db.contact.findFirst.mockResolvedValue(null);
    await expect(prepare({ contactId: "c9" })).rejects.toBeInstanceOf(ToolError);
    db.contact.findFirst.mockResolvedValue({ firstName: "A", lastName: "B", whatsappOptIn: false });
    await expect(prepare({ contactId: "c1" })).rejects.toThrow(/already marked/);
  });

  it("on approval clears the opt-in for that contact only, through the person's scope", async () => {
    const done = await apply({ contactId: "c1" });
    expect(done).toEqual({ entity: "contact", id: "c1", href: "/contacts/c1" });
    const call = db.contact.updateMany.mock.calls[0][0];
    // The record of when and how they agreed is cleared with the tick.
    expect(call.data).toEqual({ whatsappOptIn: false, whatsappOptInAt: null, whatsappOptInSource: null });
    expect(call.where).toMatchObject({ id: "c1", deletedAt: null, tenantId: "t1", ownerId: "u-sales" });
  });

  it("an admin changes any contact in their own business, never another's", async () => {
    await apply({ contactId: "c1" }, admin);
    const where = db.contact.updateMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("t1");
    expect(where.ownerId).toBeUndefined();
  });

  it("says so when the contact is gone or not theirs, and changes nothing", async () => {
    db.contact.updateMany.mockResolvedValue({ count: 0 });
    await expect(apply({ contactId: "c1" })).rejects.toMatchObject({ status: 404 });
  });

  it("has nothing a person can edit on the card", () => {
    expect(KINDS.CONTACT_OPT_OUT.edit.safeParse({}).success).toBe(true);
  });
});

describe("how WhatsApp drafts and opt-out cards reach the screen", () => {
  const row = (over: Record<string, unknown>) => ({ id: "p", conversationId: null, source: "WHATSAPP", reason: "r", kind: "TASK_CREATE", status: "PENDING", params: {}, preview: { title: "t", lines: [] }, resultEntity: null, resultId: null, failure: null, createdAt: new Date("2026-11-04T10:00:00Z"), expiresAt: new Date("2026-11-07T10:00:00Z"), decidedAt: null, ...over }) as never;

  it("tells the card which customer a WhatsApp draft goes to, and nothing for any other card", () => {
    expect(toDto(row({ kind: "MESSAGE_DRAFT", params: { channel: "WHATSAPP", contactId: "c1", message: "Hi" } })).whatsappContactId).toBe("c1");
    expect(toDto(row({ kind: "MESSAGE_DRAFT", params: { channel: "EMAIL", contactId: "c1", message: "Hi" } })).whatsappContactId).toBeNull();
    expect(toDto(row({ kind: "TASK_CREATE", params: { channel: "WHATSAPP", contactId: "c1" } })).whatsappContactId).toBeNull();
    expect(toDto(row({ kind: "CONTACT_OPT_OUT", params: { contactId: "c1" } })).approvable).toBe(true);
  });

  it("lists an undecided opt-out card first, however old, and leaves the rest in their order", async () => {
    db.aiProposal.findMany.mockResolvedValue([row({ id: "new" }), row({ id: "mid" }), row({ id: "old-stop", kind: "CONTACT_OPT_OUT" }), row({ id: "done-stop", kind: "CONTACT_OPT_OUT", status: "APPLIED" })]);
    // expireDue also uses the database; give it what it needs
    (db as unknown as { aiProposal: Record<string, unknown> }).aiProposal.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const out = await listInbox({ id: "u", tenantId: "t1" });
    expect(out.map((o) => o.id)).toEqual(["old-stop", "new", "mid", "done-stop"]);
  });
});
