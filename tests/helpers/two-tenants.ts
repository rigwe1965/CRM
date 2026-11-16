import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@/lib/prisma-client";
import { dmmfModels } from "./dmmf";

/**
 * Tenant-isolation test harness (MULTI_TENANCY_PLAN.md, Phase 0).
 *
 * Builds a throwaway Postgres schema inside TEST_DATABASE_URL, applies every migration to it, and fills it with
 * two tenants that each own one row of every business table. Phase 1 uses it to prove that tenant A can't see or
 * touch tenant B's data through any route. It never touches the schema named in DATABASE_URL.
 *
 * Phase 2 adds `appDb`: a client connected as a throwaway login role that belongs to "crm_app" (created by the row-level
 * security migration), so it is held back by the policies exactly as the production app role is. `db` stays the
 * owner/superuser connection, for fixtures and for what the platform client does.
 *
 * Without TEST_DATABASE_URL the database tests are skipped; the schema test (tenant-schema.test.ts) still runs.
 * Creating that login needs a test user who may create roles (a superuser, as in CI and the Docker database). A plain
 * database owner can't, so there `rls` is false and `appDb` is the owner connection: the application filters are still
 * proven, the row-level security tests skip themselves, and CI (which sets CI=true) refuses to run in that state.
 */

/** Tables that deliberately have no tenantId: they belong to a user (who carries it), or are the tenant itself. */
export const TENANTLESS_MODELS = ["Tenant", "Account", "Session", "VerificationToken", "JobRun"] as const;

/** Business models, in the order the generated Prisma client knows them. */
export const businessModels = () =>
  dmmfModels.map((m) => m.name).filter((n) => !(TENANTLESS_MODELS as readonly string[]).includes(n));

export const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

export const testDatabaseUrl = () => process.env.TEST_DATABASE_URL || undefined;

/**
 * The trigram migration (20261127000000) uses the pg_trgm extension. If it is not installed yet, CREATE EXTENSION puts it
 * in the schema being migrated, and dropping that throwaway schema afterwards would drop it from under the other test
 * files ("referenced operator class was concurrently dropped"). So it is installed once, in public, before any schema is
 * migrated; the advisory lock stops parallel test files racing to install it. Never fails the run: if the database does
 * not allow it, the migration reports that itself.
 */
export async function ensureTrigramExtension(client: PrismaClient) {
  try {
    await client.$transaction([
      client.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(7305001)`),
      client.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public`),
    ]);
  } catch {
    /* see above */
  }
}

const withSchema = (url: string, schema: string) => {
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
};

export type TenantFixture = { tenantId: string; admin: string; sales: string; contact: string; deal: string; invoice: string; tag: string };
export type TwoTenants = { db: PrismaClient; appDb: PrismaClient; rls: boolean; /** The throwaway schema's connection string (owner role). */ url: string; a: TenantFixture; b: TenantFixture; dispose: () => Promise<void> };

/** Creates the schema, migrates it and seeds tenants A and B. Call `dispose()` when done. */
export async function createTwoTenants(): Promise<TwoTenants> {
  const base = testDatabaseUrl();
  if (!base) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `tenant_test_${randomBytes(5).toString("hex")}`;
  const url = withSchema(base, schema);

  const admin = createPrismaClient({ url: base });
  await ensureTrigramExtension(admin);
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$disconnect();

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1" /* each run migrates its own throwaway schema; the lock is database-wide and only makes parallel test files queue */ }, stdio: "pipe" });

  const db = createPrismaClient({ url: url });
  const a = await seedTenant(db, "a");
  const b = await seedTenant(db, "b");

  // A login that only inherits crm_app's rights; the real crm_app is never given a login or a password here.
  const [me] = await db.$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolcreaterole) AS ok FROM pg_roles WHERE rolname = current_user`;
  const rls = !!me?.ok && !!(await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_roles WHERE rolname = 'crm_app'`).length;
  if (!rls && process.env.CI) throw new Error("CI needs a database user that can create roles, so the row-level security tests can run");
  const role = `crm_t_${randomBytes(5).toString("hex")}`;
  let appDb = db;
  if (rls) {
    const password = randomBytes(12).toString("hex");
    await db.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS IN ROLE crm_app`);
    const appUrl = new URL(url);
    appUrl.username = role;
    appUrl.password = password;
    appDb = createPrismaClient({ url: appUrl.toString() });
  }

  return {
    db,
    appDb,
    rls,
    url,
    a,
    b,
    dispose: async () => {
      if (appDb !== db) await appDb.$disconnect();
      await db.$disconnect();
      if (!/^tenant_test_[0-9a-f]{10}$/.test(schema)) return; // never drop anything we did not create
      const cleaner = createPrismaClient({ url: base });
      await cleaner.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      if (rls && /^crm_t_[0-9a-f]{10}$/.test(role)) await cleaner.$executeRawUnsafe(`DROP ROLE "${role}"`);
      await cleaner.$disconnect();
    },
  };
}

/**
 * One tenant with one row in every business table, all carrying its tenantId. Values that are unique across
 * the whole database today (emails, domains, tag and template names, invoice numbers, the automation key) get a
 * per-tenant suffix: Phase 1 makes them unique per tenant instead.
 */
async function seedTenant(db: PrismaClient, k: string): Promise<TenantFixture> {
  const tenantId = `tenant_${k}`;
  const t = { tenantId };
  await db.tenant.create({ data: { id: tenantId, name: `Tenant ${k.toUpperCase()}`, slug: `tenant-${k}` } });

  const adminUser = await db.user.create({ data: { ...t, email: `admin-${k}@x.test`, name: `Admin ${k}`, role: "ADMIN" } });
  const sales = await db.user.create({ data: { ...t, email: `sales-${k}@x.test`, name: `Sales ${k}`, role: "SALES" } });
  const org = await db.organization.create({ data: { ...t, name: `Org ${k}`, domain: `org-${k}.test`, ownerId: sales.id } });
  const contact = await db.contact.create({
    data: { ...t, firstName: "Ada", lastName: `Customer ${k}`, email: `ada-${k}@x.test`, phone: "+4915906462275", phoneE164: "+4915906462275", ownerId: sales.id, organizationId: org.id },
  });
  const deal = await db.deal.create({ data: { ...t, title: `Order ${k}`, amount: 300, ownerId: sales.id, contactId: contact.id, organizationId: org.id } });
  await db.dealItem.create({ data: { ...t, dealId: deal.id, position: 0, productType: "Bundle", quantity: 3, unitPrice: 100 } });
  const link = await db.paymentLink.create({ data: { ...t, dealId: deal.id, amount: 50, currency: "USD", createdById: sales.id } });
  await db.payment.create({ data: { ...t, dealId: deal.id, amount: 100, paidAt: new Date(), recordedById: sales.id } });
  const instalment = await db.instalment.create({ data: { ...t, dealId: deal.id, position: 0, dueDate: new Date(), amount: 100 } });
  await db.instalmentReminder.create({ data: { ...t, instalmentId: instalment.id, kind: "UPCOMING", recipient: `ada-${k}@x.test` } });
  const invoice = await db.invoice.create({
    data: { ...t, number: `INV-${k}-001`, invoiceDate: new Date(), vendorName: "Supplier", billTo: `Tenant ${k}`, ownerId: sales.id, deals: { connect: { id: deal.id } } },
  });
  await db.invoiceItem.create({ data: { ...t, invoiceId: invoice.id, position: 0, ref: "1-1", style: "Straight", description: "Bundle", quantity: 3, unitPrice: 100, lineTotal: 300 } });
  await db.activity.create({ data: { ...t, subject: `Note ${k}`, authorId: sales.id, contactId: contact.id } });
  await db.task.create({ data: { ...t, title: `Task ${k}`, assigneeId: sales.id, createdById: sales.id, contactId: contact.id } });
  const tag = await db.tag.create({ data: { ...t, name: `vip-${k}` } });
  await db.contactTag.create({ data: { ...t, contactId: contact.id, tagId: tag.id } });
  await db.savedFilter.create({ data: { ...t, userId: sales.id, entity: "contacts", name: "Mine", query: {} } });
  await db.emailTemplate.create({ data: { ...t, name: `Welcome ${k}`, subject: "Hi", body: "Hello {firstName}" } });
  const waTemplate = await db.whatsappTemplate.create({ data: { ...t, name: `order_update_${k}`, language: "en", body: "Hello {{1}}", status: "APPROVED" } });
  const campaign = await db.campaign.create({ data: { ...t, name: `Campaign ${k}`, templateId: waTemplate.id, createdById: adminUser.id } });
  await db.campaignRecipient.create({ data: { ...t, campaignId: campaign.id, contactId: contact.id } });
  await db.customerOrderLink.create({ data: { ...t, dealId: deal.id, tokenHash: `fixture-token-hash-${k}`, tokenSealed: "placeholder-not-real-ciphertext", expiresAt: new Date(Date.now() + 86_400_000), createdById: sales.id } });
  await db.automationSetting.create({ data: { ...t, key: `lead-form-${k}`, config: {} } });
  await db.stockAdjustment.create({ data: { ...t, product: "Bundle", quantity: 1, reason: "Found", ownerId: sales.id } });
  await db.stockThreshold.create({ data: { ...t, key: `bundle||`, product: "Bundle", threshold: 2 } });
  await db.tenantIntegration.create({ data: { ...t, kind: "LEAD_FORM", config: "placeholder-not-real-ciphertext" } });
  const chat = await db.aiConversation.create({ data: { ...t, userId: sales.id, title: `Chat ${k}` } });
  await db.aiMessage.create({ data: { ...t, conversationId: chat.id, position: 0, role: "USER", content: [{ type: "text", text: `Hello ${k}` }] } });
  await db.aiUsage.create({ data: { ...t, userId: sales.id, conversationId: chat.id, model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 5, costMicros: 80 } });
  await db.aiCredit.create({ data: { ...t, amountMicros: 1_000_000, source: "PACK", reference: `seed-${k}`, note: "fixture" } });
  await db.aiInboxRun.create({ data: { ...t, userId: sales.id, day: "2026-10-30", status: "DONE", candidates: 1, created: 1 } });
  await db.aiTriage.create({ data: { ...t, activityId: `act-${k}`, contactId: contact.id, status: "DONE", label: "OTHER", urgency: "LOW", summary: "Fixture", modelCalled: true } });
  await db.knowledgeEntry.create({ data: { ...t, key: `fixture-${k}`, category: "FAQ", title: `Fixture ${k}`, body: `Policy text ${k}`, keywords: ["fixture"], versions: { create: { ...t, version: 1, title: `Fixture ${k}`, body: `Policy text ${k}`, status: "ACTIVE" } } } });
  await db.aiProposal.create({ data: { ...t, userId: sales.id, conversationId: chat.id, kind: "TASK_CREATE", params: { title: `Proposed ${k}` }, preview: { title: "Create a task", lines: [] }, expiresAt: new Date(Date.now() + 86_400_000) } });
  await db.auditLog.create({ data: { ...t, action: `fixture.${k}`, actorId: adminUser.id } });
  void link;

  return { tenantId, admin: adminUser.id, sales: sales.id, contact: contact.id, deal: deal.id, invoice: invoice.id, tag: tag.id };
}
