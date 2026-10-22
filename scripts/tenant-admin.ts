// The platform owner's controls over businesses (there is deliberately no screen for this in the app):
//   npm run tenant-admin -- list
//   npm run tenant-admin -- suspend <tenantId>            everyone in the business is signed out and locked out
//   npm run tenant-admin -- resume <tenantId>
//   npm run tenant-admin -- extend-trial <tenantId> <days>   push the end of the free trial out (from today if it ended)
// Run against the production DATABASE_URL (or PLATFORM_DATABASE_URL, the owner role, which is preferred).
// Nothing is deleted here; removing a business's data is Phase 5.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const [cmd, id, days] = process.argv.slice(2);
const db = new PrismaClient({ datasourceUrl: process.env.PLATFORM_DATABASE_URL || undefined });

async function main() {
  if (cmd === "list") {
    const rows = await db.tenant.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { users: true, contacts: true } } } });
    console.table(
      rows.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        plan: t.plan,
        billing: t.billingStatus,
        trialEnds: t.trialEndsAt?.toISOString().slice(0, 10) ?? "",
        users: t._count.users,
        contacts: t._count.contacts,
        created: t.createdAt.toISOString().slice(0, 10),
      })),
    );
    return;
  }
  if (!id) throw new Error("A tenant id is required (npm run tenant-admin -- list shows them)");
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) throw new Error(`No business with id ${id}`);

  if (cmd === "suspend" || cmd === "resume") {
    if (tenant.status === "PENDING") throw new Error("That signup has not confirmed its email; it is deleted automatically after a week");
    await db.tenant.update({ where: { id }, data: { status: cmd === "suspend" ? "SUSPENDED" : "ACTIVE" } });
    console.log(`${tenant.name}: ${cmd === "suspend" ? "suspended (signed-in users are refused within 30 seconds)" : "resumed"}`);
  } else if (cmd === "extend-trial") {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("extend-trial needs a number of days between 1 and 365");
    const from = tenant.trialEndsAt && tenant.trialEndsAt > new Date() ? tenant.trialEndsAt : new Date();
    const trialEndsAt = new Date(from.getTime() + n * 86_400_000);
    await db.tenant.update({ where: { id }, data: { trialEndsAt, billingStatus: tenant.billingStatus === "ACTIVE" ? "ACTIVE" : "TRIALING" } });
    console.log(`${tenant.name}: trial now ends ${trialEndsAt.toISOString().slice(0, 10)}`);
  } else {
    throw new Error("Usage: npm run tenant-admin -- list | suspend <id> | resume <id> | extend-trial <id> <days>");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
