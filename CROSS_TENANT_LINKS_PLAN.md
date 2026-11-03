# Plan: the database refuses links between businesses

Status: **implemented** (triggers, option chosen by the owner; soft links left out). Migration `20261125000000_same_tenant_links`, `tests/same-tenant-links.test.ts`, `scripts/audit-cross-tenant-links.ts`. The production audit (step 3) has not been run.

## The gap

Row-level security stops a business reading or writing another business's rows. It does not stop a row from
*pointing at* another business's row: a foreign key is checked by the database without RLS. Today only the
application prevents it (`assertLinks`, `assertTags`), and one forgotten call is the only thing between a bug and,
for example, a deal linked to another business's contact. Reads through such a link return nothing, but the row
exists and can be rewritten or deleted by cascades.

There are 40 such links across the business tables (16 of them to `User`, the rest among Contact, Deal, Task,
Activity, Payment, Instalment, Invoice, Campaign, AI tables and so on). The implicit `_DealToInvoice` table is already
covered by its own policy (commit 45fe1ed).

## Options considered

| Option | Verdict |
|---|---|
| **Composite foreign keys** `(tenantId, xId) -> (tenantId, id)` | The textbook fix, but Prisma cannot express `ON DELETE SET NULL` for it (it would try to null the required `tenantId` too), so 20+ optional links would need hand-written SQL that `schema.prisma` can't describe. CI's "schema and migrations are in sync" check would then fail. Rejected for now. |
| **Row triggers** that check "the referenced row has my `tenantId`" | Invisible to Prisma, no schema change, no change to delete behaviour, same pattern as the append-only audit-log triggers. **Recommended.** |
| Leave it to the application | Status quo. |

## Proposal (triggers)

1. **One generic trigger function**, `enforce_same_tenant()`, taking the referenced table and column as arguments.
   On INSERT, and on UPDATE of the link column or `tenantId`, it raises an error unless the referenced row exists with
   the same `tenantId`. A NULL link passes. It compares `tenantId` explicitly, so it behaves the same for the
   restricted app role (under RLS) and for the owner/platform client (not bound).
2. **One migration** that attaches it to the 40 links, with a rollback comment block in the style of
   `20261124000000_deal_invoice_rls`. Hand-written SQL, per the project convention.
3. **A pre-flight audit query** (read-only, run by you on production before the migration) listing any existing row
   whose link crosses businesses. The triggers only guard new writes, so existing violations must be known first.
   If any exist, we decide per case; nothing is deleted automatically.
4. **Tests**
   - Database test, generated from Prisma's model metadata so a *new* link is covered automatically: for each of
     the 40 links, a raw insert/update pointing at the other business's row is rejected, and a same-business one is
     accepted.
   - A catalog test (alongside `tests/rls-catalog.test.ts`) that every foreign key to a business table has its trigger.
   - The existing two-tenant suite must stay green (the triggers must not reject legitimate writes).
5. **Docs**: one paragraph in `TECHNICIAN.md` ("Adding a table": a link to another business table needs the trigger),
   and the "What it does not cover" note updated.

## Risks and costs

- **Write cost**: one primary-key lookup per link per write. Negligible.
- **Migration risk**: low. Adds triggers only; no table is rewritten, no data changes. Rollback is `DROP TRIGGER`.
- **A missed link** (a column that is a plain string, not a real foreign key, such as `AiTriage.activityId`) is not
  covered by this; step 4's generated test lists them so they can be decided one by one.
- **Seed and fixtures** already use same-business links, so they should pass; the test run proves it.

## Decisions needed from the owner

1. Approve triggers (recommended) over composite foreign keys?
2. Run the pre-flight audit on production first (needed before step 2 ships)?
3. Include the plain-string "soft links" (e.g. `AiTriage.activityId`) or leave them out for now?
