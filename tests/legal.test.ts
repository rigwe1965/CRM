import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { acceptanceConfig, LEGAL_DOCS, LEGAL_VERSION, legalEntity } from "@/lib/legal";
import { SUBPROCESSORS } from "@/lib/legal-content";
import { isPublicPath } from "@/lib/rbac";
import { signupSchema } from "@/lib/validations/auth";

// The pages are JSX, which the test runner does not compile, so they are read as text.
const page = (name: string) => readFileSync(`src/app/(legal)/${name}/page.tsx`, "utf8");

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/platform-db", () => ({ platformDb: {} }));
import { AI_RETENTION_DAYS } from "@/lib/ai/retention";
import { DELETION_GRACE_DAYS } from "@/lib/tenant-deletion";
import { PENDING_SIGNUP_DAYS } from "@/lib/signup";

afterEach(() => vi.unstubAllEnvs());

const company = { LEGAL_ENTITY_NAME: "Ivycandy Ltd", LEGAL_ADDRESS: "1 High Street, Lagos", LEGAL_GOVERNING_LAW: "Nigeria", SUPPORT_EMAIL: "help@shop.test" };

describe("who the documents are from", () => {
  it("shows [to be completed] and counts as a draft until every detail is set and review is confirmed", () => {
    const empty = legalEntity({});
    expect(empty).toMatchObject({ name: "[to be completed]", complete: false, reviewed: false });
    expect(legalEntity({ ...company })).toMatchObject({ complete: true, reviewed: false });
    expect(legalEntity({ ...company, LEGAL_REVIEWED: "1" }).reviewed).toBe(true);
    expect(legalEntity({ LEGAL_REVIEWED: "1" }).reviewed).toBe(false); // review cannot be claimed with details missing
  });
  it("records which version was accepted, when and by whom", () => {
    expect(acceptanceConfig("u1", new Date("2026-11-02T10:00:00Z"))).toEqual({ version: LEGAL_VERSION, acceptedAt: "2026-11-02T10:00:00.000Z", acceptedById: "u1" });
  });
});

describe("the three documents", () => {
  it("can be read without signing in", () => {
    for (const d of LEGAL_DOCS) expect(isPublicPath(d.href)).toBe(true);
  });
  it("take the business name, address and law from the settings, never hard-coded", () => {
    for (const p of ["terms", "privacy", "dpa"]) expect(page(p)).toContain("legalEntity(");
    expect(page("terms")).toContain("{e.governingLaw}");
    expect(page("terms")).toContain('href="/privacy"');
    expect(page("terms")).toContain('href="/dpa"');
  });
  it("build the provider list from one shared list, so the privacy policy and the addendum cannot disagree", () => {
    expect(page("privacy")).toContain("SUBPROCESSORS.map");
    expect(page("dpa")).toContain("SUBPROCESSORS.map");
    expect(SUBPROCESSORS.map((s) => s.name)).toEqual(expect.arrayContaining(["Vercel", "Stripe", "Resend", "Upstash", "Anthropic", "Meta (WhatsApp Business)"]));
  });
  it("make only claims the product keeps: deletion period, AI retention, no card numbers, no ad cookies", () => {
    const text = page("privacy") + page("terms");
    expect(text).toContain("30 days");
    expect(text).toContain("90 days");
    expect(text).toMatch(/never see or store card numbers/);
    expect(text).toMatch(/do not use advertising or analytics cookies/);
  });
});

describe("the periods the documents promise match the code", () => {
  it("deletion grace, AI conversation retention and unconfirmed sign-up clean-up", () => {
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(AI_RETENTION_DAYS).toBe(90);
    expect(PENDING_SIGNUP_DAYS).toBe(7);
    expect(page("privacy")).toContain(`${PENDING_SIGNUP_DAYS} days`);
    expect(page("privacy")).toContain(`${AI_RETENTION_DAYS} days`);
    expect(page("terms")).toContain(`${DELETION_GRACE_DAYS} days`);
  });
});

describe("signing up", () => {
  const base = { businessName: "Fresh Hair Co", name: "Nia Okoro", email: "nia@fresh.test", password: "Sup3r-secret-pw" };
  it("needs the terms to be accepted", () => {
    expect(signupSchema.safeParse(base).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
  });
});

describe("included AI wording (INCLUDED_AI_PLAN.md)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("no longer says AI only ever runs through the business's own account", () => {
    for (const f of ["src/lib/legal-content.ts", "src/app/(legal)/privacy/page.tsx", "src/app/(legal)/terms/page.tsx"]) {
      expect(read(f), f).toMatch(/our account|service's account|service&apos;s account/);
    }
    expect(read("src/app/(legal)/dpa/page.tsx")).toContain("our sub-processor");
  });
  it("tells businesses that included AI is measured, renews monthly, and credit is for the assistant only", () => {
    const terms = read("src/app/(legal)/terms/page.tsx");
    expect(terms).toContain("does not carry over");
    expect(terms).toContain("for the assistant only");
    expect(read("src/app/(legal)/privacy/page.tsx")).toContain("we do not use the content of questions for any other purpose");
  });
  it("leaves the open points marked for the owner and the lawyer rather than deciding them", () => {
    expect(read("src/app/(legal)/terms/page.tsx")).toContain("[Owner to decide:");
    expect(read("src/app/(legal)/dpa/page.tsx")).toContain("[Lawyer to confirm.]");
  });
  it("keeps the version unchanged: it is bumped on the day included AI is switched on, so businesses re-accept once", () => expect(LEGAL_VERSION).toBe("2026-11-01"));
});
