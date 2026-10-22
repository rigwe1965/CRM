# Plan: multi-tenancy for the Ivycandy CRM

- **Status:** plan approved by the owner on 2026-10-22. Phases 0 and 1 are built (see below); Phases 2 to 5 are not started. Each phase below needs its own go-ahead before work on it starts (CLAUDE.md: no code changes without an approved plan).
- **Goal:** let several separate businesses use one deployment of this CRM without ever seeing each other's data, so it can be offered as a paid service.

## What the code looks like today

- **No tenant concept.** Data is scoped by user (`ownerScope`, `authorScope`, `taskScope` in `src/lib/access.ts`). 34 files use those helpers, and 31 files query models that have no owner scope at all (`User`, `Tag`, `EmailTemplate`, `AutomationSetting`, `AuditLog`, `SavedFilter`). There are 66 route files.
- **Global unique constraints that would collide between businesses:** `User.email`, `Contact.email`, `Organization.domain`, `Tag.name`, `EmailTemplate.name`, `Invoice.number`, `AutomationSetting.key`.
- **Per-business settings live in environment variables:** the Stripe keys and webhook secret, the four WhatsApp variables, `LEAD_FORM_ORIGINS` and `EMAIL_FROM`. The lead-form owner is stored in `AutomationSetting`.
- **Raw SQL** in `src/lib/cashflow.ts` and the deal and payment row locks (`SELECT … FOR UPDATE`) does not pick up any automatic scoping.
- **Global entry points:** the Stripe and WhatsApp webhooks, the public lead form, the daily cron, and the rate-limit keys.

## Recommended design

**One shared database with a `tenantId` column on every business table, plus Postgres row-level security (RLS) as a safety net.**

- Not one database per customer: it is the safest isolation, but migrations, backups and cost multiply with every customer, which does not suit a solo owner.
- Not application filtering alone: one forgotten `where` clause would leak one customer's data to another. RLS makes the database refuse cross-tenant reads and writes even if the code forgets.
- `ADMIN` stays the business admin. A separate platform-owner role (the owner) is used from scripts only, never from the app screens.
- One user belongs to one tenant at first. That keeps `User.email` globally unique and avoids a membership table.

## Phases

### Phase 0: groundwork (no behaviour change)

**Status: done (code, not yet applied to the owner's dev database).** What was built, and where it differs from the text below:

- Migration `20261028000000_tenants`: a `Tenant` table, the original business `tenant_ivycandy`, and a `tenantId` on all 20 business tables (every table except `Account`, `Session`, `VerificationToken`, which belong to a user). The column is added as `NOT NULL DEFAULT 'tenant_ivycandy'` in one step instead of "nullable, backfill, then required": a constant default fills existing rows without rewriting them, which the append-only audit log needs (it refuses `UPDATE`). The audit log gets the column and an index but no foreign key, by design.
- The default stayed until Phase 1, so no create had to change in Phase 0; Phase 1 removed it.
- Rehearsed on a copy: the 20 old migrations plus sample rows, then this migration. Existing rows got the original tenant, a row for a missing tenant is refused, the audit log stayed append-only, and `prisma migrate diff` reports no difference between the migrations and the schema.
- Seed: ensures the original tenant exists, then loads the sample data into it.
- Harness: `tests/helpers/two-tenants.ts` builds a throwaway schema with tenants A and B, each owning a row in every business table. `tests/tenant-schema.test.ts` (no database) and `tests/tenant-isolation.test.ts` (needs `TEST_DATABASE_URL`, set in CI) guard it. The route-level tests are in `tests/tenant-routes.test.ts` (Phase 1).
- Not changed: API responses may now include the row's own `tenantId` where whole rows are returned; nothing reads it.
- Applying it to a `db:push` dev database is a manual step: see TECHNICIAN.md.

- Add a `Tenant` model (name, slug, status, plan, brand name, sender name).
- Add a nullable `tenantId` to every business table, backfill it with a tenant for Ivycandy, then make it required. Hand-written migration SQL, per CLAUDE.md.
- Update the seed so the newcomer sample sits inside a sample tenant (seed data stays a newcomer sample).
- Ship a **tenant-isolation test harness** with two seeded tenants. It stays in the repo for every later phase.
- **Check:** the app behaves exactly as before for Ivycandy.

### Phase 1: scope every query

**Status: done (code, not yet applied to the owner's dev database).** What was built, and where it differs from the text below:

- `tenantId` is in the session and JWT (read from the database on every session check, cached 30 s with the user). A suspended business is signed out like a deactivated user.
- `tenantScope(user)` is in `src/lib/access.ts`, and `ownerScope`, `authorScope` and `taskScope` include it, so the 34 files that already used them are scoped without edits. Admins are the business admin: they see their whole business, never another.
- Models with no owner scope (users, tags, templates, saved filters, settings, audit log, payments, instalments, invoice items, contact tags) name the business directly. Ids in a request (`tagIds`, `ownerId`, `organizationId`, `contactId`, `dealId`, `dealIds`, assignees, the lead-form owner) must belong to the caller's business (`assertLinks`, new `assertTags`, `resolveOwner`).
- Unique per business (migration `20261029000000_tenant_uniques`): contact email, organization domain, tag name, template name, invoice number, automation setting key. `User.email` stays global.
- The default is gone (migration `20261030000000_tenant_required`): a create without a tenant is a type error and a database error.
- Raw SQL: `cashflow.ts`, the deal and admin row locks and the payment-link lock all filter on the business. A payment from Stripe is credited to the payment link's own business, and the deal is looked up inside it.
- The daily automations run once per active business on that business's settings; the reminder digests stay one job across businesses (one email per user, none for suspended businesses).
- Audit entries carry the actor's business; events that belong to no business (an unknown email signing in) are filed under `platform`.
- The website form and the WhatsApp webhook file leads under the original business (`DEFAULT_TENANT_ID`) until Phase 3.
- Guards: `tests/tenant-scoping.test.ts` (reads the source; fails on a query that doesn't name the business) and `tests/tenant-routes.test.ts` (real handlers on a real database with two businesses: 404 for every route by id, links refused, lists, dashboard money, audit log and CSV exports hold only the caller's rows, same values allowed in both businesses). Breaking `tenantScope` on purpose makes 39 of them fail.
- Not done here: Postgres row-level security (Phase 2), per-business Stripe/WhatsApp/lead-form settings (Phase 3).

- Add `tenantId` to the session and JWT, and to `requireApiUser` and `authed()`, so every handler receives it.
- Add one `tenantScope(user)` helper and combine it with the existing `ownerScope`, so the owner rules still apply inside a tenant.
- Make the unique constraints per tenant, for example `@@unique([tenantId, email])` on contacts and `[tenantId, number]` on invoices. `User.email` stays global.
- Add `tenantId` to the raw SQL in `cashflow.ts` and to the row-lock queries.
- Add a test, in the style of `tests/route-contract.test.ts`, that fails if a route queries a business model without a tenant filter.
- **Check:** the two-tenant tests prove tenant A cannot read, edit, delete, export or link to tenant B's records through any route, including by guessing IDs.

### Phase 2: database backstop (RLS)

- Enable RLS on every business table with a policy of `tenantId = current_setting('app.tenant_id')`.
- Wrap each request's queries in a transaction that sets that value with `SET LOCAL`, through a Prisma client extension.
- Use a separate database role for the app that cannot bypass RLS, and a different role for migrations and platform scripts.
- **Check:** with the app-code filters deliberately removed in a test, cross-tenant access still fails. Highest technical risk, because it interacts with connection pooling.

### Phase 3: per-tenant integrations

- Move Stripe keys, WhatsApp credentials, allowed website origins and sender settings out of environment variables into an encrypted per-tenant settings table, reusing the MFA secret encryption approach.
- Give each tenant its own webhook URLs (`/api/webhooks/stripe/<tenant>` and `/api/webhooks/whatsapp/<tenant>`), each verified against that tenant's secret.
- Give the public lead form a tenant key, with allowed origins stored per tenant.
- Make the daily cron loop over tenants, and make rate-limit keys include the tenant.
- **Check:** a payment or message for tenant A can never be recorded against tenant B.

### Phase 4: onboarding and billing

- Self-signup that creates a tenant and its first admin, with email verification.
- Subscription billing with Stripe Billing (plan, trial, status), kept separate from the customers' payment links.
- Plan limits; an unpaid or cancelled tenant becomes read-only, and exporting its data stays allowed.
- Tenant admin screens: branding, team and integration settings.
- **Check:** the sign-up, trial, upgrade and cancel flows work end to end in Stripe test mode.

### Phase 5: launch readiness

- Tenant-wide export and deletion: a hard-delete job after a retention period, and a data export on request.
- Terms, a privacy policy and a data-processing agreement (these need a lawyer).
- Per-tenant limits on email, WhatsApp and API usage to contain abuse and cost.
- A further independent security review focused on tenant isolation, and ideally a short external penetration test.

## Main risks

1. **Cross-tenant leaks.** One missed filter exposes one customer's data to another. This is the reason for the test harness and RLS.
2. **Raw SQL and locks.** They bypass any automatic filtering, so each one needs hand review.
3. **Connection pooling with RLS.** `SET LOCAL` only works inside a transaction. Prove it against the real database provider (Neon or Supabase pooling) in Phase 2 before relying on it.
4. **Migration of live Ivycandy data.** Rehearse the backfill on a copy and take a backup before the real run.
5. **Scope creep.** Each phase ends with a working, deployable app, so work can stop after any phase.

## Conventions to keep

- Money stays per currency (`MoneyMap`); never sum across currencies, and not across tenants either.
- Soft-deleted contacts, deals and organizations stay soft-deleted; their uniqueness rules become per tenant.
- API routes keep using `authed()`; routes that hard-delete keep calling `audit()` with a snapshot first.
- Schema changes: hand-written migration SQL, then restart the dev server.

## Open decisions (recommended default in bold)

1. Isolation approach: **shared database with RLS**, or one database per customer.
2. Users in several businesses: **not for now**, or membership support from the start.
3. Phase 3 payments: **each tenant brings its own Stripe account**, or Stripe Connect to take payments on their behalf (more setup and compliance).
4. Order of work: **approve Phases 0 and 1 first**, since later phases depend on the isolation test results.

These were put to the owner with the plan. Phases 0 and 1 will be done as a series of small, reviewable commits. Until the owner confirms otherwise, the recommended defaults apply.
