// `npx tsx scripts/audit-cross-tenant-links.ts`: READ-ONLY. Lists rows that point at another business's row.
//
// The same-business triggers (migration 20261125000000_same_tenant_links) guard new writes only, so run this once,
// before or after applying it, to find links that already cross businesses. It issues only SELECT statements, and it
// connects as PLATFORM_DATABASE_URL (the owner role, which row-level security does not bind) when that is set,
// otherwise DATABASE_URL, which as the restricted app role would see nothing. Nothing is changed or deleted.
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const closed = new Set(["Tenant", "Account", "Session", "VerificationToken", "JobRun"]);
const links = Prisma.dmmf.datamodel.models
  .filter((m) => !closed.has(m.name))
  .flatMap((m) => m.fields.filter((f) => f.relationFromFields?.length === 1 && !closed.has(f.type)).map((f) => ({ child: m.name, column: f.relationFromFields![0], parent: f.type })));

async function main() {
  const url = process.env.PLATFORM_DATABASE_URL || undefined;
  const db = new PrismaClient({ datasourceUrl: url });
  let bad = 0;
  try {
    const [me] = await db.$queryRaw<{ bypass: boolean; owner: boolean }[]>`
      SELECT (rolsuper OR rolbypassrls) AS bypass,
        EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'Contact' AND tableowner = current_user) AS owner FROM pg_roles WHERE rolname = current_user`;
    if (!me?.bypass && !me?.owner) console.warn("WARNING: this role is bound by row-level security, so rows may be hidden and the audit incomplete. Set PLATFORM_DATABASE_URL to the owner role.");

    for (const l of links) {
      // Identifiers come from the Prisma schema above, never from input.
      const rows = await db.$queryRawUnsafe<{ id: string; child_tenant: string; parent_tenant: string }[]>(
        `SELECT c.ctid::text AS id, c."tenantId" AS child_tenant, p."tenantId" AS parent_tenant
         FROM "${l.child}" c JOIN "${l.parent}" p ON p."id" = c."${l.column}"
         WHERE c."tenantId" <> p."tenantId" LIMIT 50`,
      );
      if (rows.length) {
        bad += rows.length;
        console.log(`${l.child}.${l.column} -> ${l.parent}: ${rows.length}${rows.length === 50 ? "+" : ""} cross-business link(s)`);
        for (const r of rows.slice(0, 5)) console.log(`   ${l.child} ${r.id} (${r.child_tenant}) -> ${r.parent_tenant}`);
      }
    }
  } finally {
    await db.$disconnect();
  }
  console.log(bad === 0 ? `Checked ${links.length} links: none cross businesses.` : `Found ${bad}+ cross-business link(s). Nothing was changed.`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
