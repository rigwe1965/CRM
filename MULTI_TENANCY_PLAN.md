# Plan: multi-tenancy for the Ivycandy CRM

- **Status:** plan approved by the owner on 2026-10-22. Phases 0 to 4 are built (see below); Phase 5 is built except the parts that need a lawyer or an outside tester. All migrations are applied to the owner's local dev database, and the full test suite (511 tests, including the row-level security tests) passed against a real Postgres on 2026-10-22. Still unverified: Stripe test mode and the real hosting provider's connection pooling. Each phase below needs its own go-ahead before work on it starts (CLAUDE.md: no code changes without an approved plan).
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

**Status: done (applied to the owner's dev database, checked 2026-10-22).** What was built, and where it differs from the text below:

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

**Status: done (applied to the owner's dev database, checked 2026-10-22).** What was built, and where it differs from the text below:

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

**Status: done (applied to the owner's dev database, but the policies don't bind there: the `crm` login is the table owner and can't create the `crm_app` role, so only the application filters protect local data). The `tests/rls.test.ts` tests need a role-creating Postgres: CI has one, and on 2026-10-22 all 10 passed on the owner's machine against a throwaway database on a superuser login, which was dropped afterwards. Not yet proven on the real hosting provider's connection pooling (risk 3 below).** What was built, and where it differs from the text below:

- Migration `20261031000000_row_level_security`: RLS and a `tenant_isolation` policy (`USING` and `WITH CHECK` on `tenantId`) on all 20 business tables, a read-own-row policy on `Tenant`, and a `crm_app` role (created without a login) with the table grants. The app role cannot write `Tenant`, edit or delete the audit log, or touch `Account`, `Session` and `VerificationToken`. The policy is not forced on the table owner, so the owner role stays the platform and migration role. Role creation is best-effort: without CREATEROLE the migration prints a notice and still creates the policies.
- `src/lib/db.ts` is now a Prisma client extension (`src/lib/tenant-db.ts`) that sets `app.tenant_id` with `set_config(..., true)` inside each query's own transaction, for single queries, `$transaction(fn)` and `$transaction([...])`. The setting lasts for one transaction, so it is safe through a pooled connection, and tests prove overlapping requests never see each other's rows. The business comes from `AsyncLocalStorage` (`src/lib/tenant-context.ts`); `authed()` sets it from the session, and a query with no business set is refused.
- Differs from the plan: a second client, `platformDb` (connects as `PLATFORM_DATABASE_URL`, the owner role), exists for work that belongs to no single business: sign-in and tokens, the daily jobs that loop over businesses, and the Stripe webhook's first lookup. A test lists the only files allowed to use it. The daily job, the public form and the WhatsApp webhook run each business inside `withTenant`.
- A bug the tests found on the way: a streamed CSV or zip download reads its rows after `authed()` has returned, which would have lost the business; both streams now re-enter it (`keepTenant`).
- `tests/rls.test.ts` removes every application filter and proves the database alone still refuses: unfiltered reads, updates and deletes touch only the caller's rows on all 20 tables, a write naming another business is refused, and transactions, row locks and raw queries hold. `tests/tenant-routes.test.ts` now runs every route under the restricted login. At start in production the server logs an error if `DATABASE_URL` connects as a role the policies do not bind.
- Not covered by RLS, by design: foreign keys (the application's `assertLinks` refuses cross-business links), the platform client, superusers and the migration role.

- Enable RLS on every business table with a policy of `tenantId = current_setting('app.tenant_id')`.
- Wrap each request's queries in a transaction that sets that value with `SET LOCAL`, through a Prisma client extension.
- Use a separate database role for the app that cannot bypass RLS, and a different role for migrations and platform scripts.
- **Check:** with the app-code filters deliberately removed in a test, cross-tenant access still fails. Highest technical risk, because it interacts with connection pooling.

### Phase 3: per-tenant integrations

**Status: done (applied to the owner's dev database, checked 2026-10-22).** What was built, and where it differs from the text below:

- Migration `20261101000000_tenant_integrations`: `TenantIntegration` (business, service, encrypted settings), with row-level security like every business table. Settings are sealed with the two-step-secret key and also name their business and service inside the encryption.
- Stripe keys, the four WhatsApp values and the website form's allowed origins come from that table (`src/lib/integrations.ts`). Admin API `/api/admin/integrations` to read what is set up (never the secrets), save and remove; the screens are Phase 4.
- Per-business addresses: `/api/webhooks/stripe/<id>`, `/api/webhooks/whatsapp/<id>`, `/api/public/lead/<id>`, each verified against that business's own secret or origins. The original addresses stay for the original business, which also keeps falling back to its environment variables until it saves settings, so nothing changes for Ivycandy.
- A Stripe event that names another business's payment link is refused (a business controls its own Stripe account, so this is the check that matters). Rate-limit keys for the website form include the business. The daily cron already ran per business (Phase 1).
- Differs from the plan: the email sender stays one address per deployment; a sender per business needs domain verification and moves to Phase 4.
- `tests/tenant-integrations.test.ts` proves, on a real database with two businesses, that a payment or message for one can't be recorded against the other, that settings and webhooks answer only for their own business, and that secrets never leave the server.

- Move Stripe keys, WhatsApp credentials, allowed website origins and sender settings out of environment variables into an encrypted per-tenant settings table, reusing the MFA secret encryption approach.
- Give each tenant its own webhook URLs (`/api/webhooks/stripe/<tenant>` and `/api/webhooks/whatsapp/<tenant>`), each verified against that tenant's secret.
- Give the public lead form a tenant key, with allowed origins stored per tenant.
- Make the daily cron loop over tenants, and make rate-limit keys include the tenant.
- **Check:** a payment or message for tenant A can never be recorded against tenant B.

### Phase 4: onboarding and billing

**Status: done (applied to the owner's dev database, checked 2026-10-22; never run against real Stripe test mode).** What was built, and where it differs from the text below:

- Migration `20261102000000_billing`: trial and subscription fields on `Tenant`, a `PENDING` status for unconfirmed signups, and a column-limited grant so a business's admin can edit its name, brand and sender name but never its billing.
- Sign-up (`/sign-up`, `POST /api/signup`): off unless `SIGNUP_ENABLED=1`; creates a `PENDING` business on a 14-day trial plus its first admin and emails a 24-hour confirmation link; nobody signs in until it is used; unconfirmed signups are deleted after 7 days. Rate limited, and answers the same for an existing email. A Cloudflare Turnstile CAPTCHA was added afterwards (`TURNSTILE_*`, required in production while sign-up is open).
- Billing on the platform's own Stripe account: Checkout to subscribe, the customer portal to manage or cancel, and a signed webhook (`/api/webhooks/billing`) that applies subscription events by the stored customer id, ignoring stale ones. Two paid plans (Starter, Pro) with user and contact limits in `src/lib/plans.ts`; prices and limits are placeholders for the owner to set.
- Read-only mode for an expired trial or a lapsed subscription: writes return `READ_ONLY` except billing and the user's own account; reading and export keep working. Plan limits refuse extra users and contacts (`PLAN_LIMIT`).
- Admin screens in Settings: Business, Billing, Integrations. The platform owner's controls are `npm run tenant-admin` (list, suspend, resume, extend a trial), by design not a screen.
- A leak found on the way: a new business's instalment emails would have defaulted to the brand name "Ivycandy Hair"; they now default to the business's own name.
- Differs from the plan: a sender address per business was not built in Phase 4 (it needs domain verification; only the display name was per business). It was added afterwards through Resend domains (see `TECHNICIAN.md`, "Sender address per business"). Export on cancellation is the existing export, which stays allowed.

- Self-signup that creates a tenant and its first admin, with email verification.
- Subscription billing with Stripe Billing (plan, trial, status), kept separate from the customers' payment links.
- Plan limits; an unpaid or cancelled tenant becomes read-only, and exporting its data stays allowed.
- Tenant admin screens: branding, team and integration settings.
- **Check:** the sign-up, trial, upgrade and cancel flows work end to end in Stripe test mode.

### Phase 5: launch readiness

**Status: partly done (the code is applied to the owner's dev database, checked 2026-10-22).** Built: business deletion with a 30-day grace period and a daily erasure job (Settings, Business; the business is read-only meanwhile, export and cancelling still work; the Stripe customer and its invoices and one name-only platform audit line are kept; backups keep older copies until they expire), the audit log's one controlled delete exception, daily email and WhatsApp caps per plan, and a fix to Phase 4: read-only mode had been blocking the export routes, which are now on its allow list. **Still open and not mine to do:** terms of service, privacy policy and data-processing agreement (a lawyer), and the independent isolation review or penetration test. Details are in `TECHNICIAN.md`, "Deleting a business and message caps".

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
