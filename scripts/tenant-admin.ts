// The platform owner's controls over businesses (there is deliberately no screen for this in the app):
//   npm run tenant-admin -- list
//   npm run tenant-admin -- suspend <tenantId>            everyone in the business is signed out and locked out
//   npm run tenant-admin -- resume <tenantId>
//   npm run tenant-admin -- extend-trial <tenantId> <days>   push the end of the free trial out (from today if it ended)
//   npm run tenant-admin -- create "<business name>" <admin email> [--plan trial|starter|pro] [--admin-name "Name"] [--trial-days N]
//       makes a business that is active at once (a pilot, say) with its first admin, and prints a 7-day set-password link
//   npm run tenant-admin -- set-plan <tenantId> trial|starter|pro [--force]   move a business to another plan by hand
//   npm run tenant-admin -- grant-credit <tenantId> <dollars> [--note "why"] [--force]   give a business free AI credit (max $100 without --force)
//   npm run tenant-admin -- credit <tenantId>   how much AI credit a business has left
// Run against the production DATABASE_URL (or PLATFORM_DATABASE_URL, the owner role, which is preferred).
// Nothing is deleted here; removing a business's data is Phase 5.
import "dotenv/config";
import { createPrismaClient } from "../src/lib/prisma-client";
import { createBusiness, creditLeftMicros, grantCredit, isPlanChoice, PLAN_CHOICES, setPlan } from "./tenant-admin-lib";

const argv = process.argv.slice(2);
const [cmd, id, days] = argv;
/** The value after `--flag`, or undefined. */
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const db = createPrismaClient({ url: process.env.PLATFORM_DATABASE_URL || undefined });

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
  if (cmd === "create") {
    const email = argv[2];
    if (!id || !email || id.startsWith("--") || email.startsWith("--")) throw new Error('Usage: npm run tenant-admin -- create "<business name>" <admin email> [--plan trial|starter|pro] [--admin-name "Name"] [--trial-days N]');
    const plan = flag("plan") ?? "trial";
    if (!isPlanChoice(plan)) throw new Error(`--plan must be one of: ${PLAN_CHOICES.join(", ")}`);
    const trialDays = flag("trial-days") === undefined ? undefined : Number(flag("trial-days"));
    const made = await createBusiness(db, { name: id, adminEmail: email, adminName: flag("admin-name"), plan, trialDays });
    const base = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").replace(/\/$/, "");
    console.log(`Created ${made.tenant.name} (id ${made.tenant.id}, plan ${made.tenant.plan}). Admin: ${made.email}`);
    console.log(base ? `Send ${made.email} this link to set a password (valid 7 days, works once):
${base}/reset-password?token=${made.token}` : `NEXTAUTH_URL is not set here, so no full link. Token (valid 7 days): ${made.token}  ->  <your domain>/reset-password?token=<token>`);
    console.log("On first sign-in the admin is asked to accept the terms, and must turn on two-step verification before admin pages open.");
    return;
  }
  if (!id) throw new Error("A tenant id is required (npm run tenant-admin -- list shows them)");
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) throw new Error(`No business with id ${id}`);

  if (cmd === "set-plan") {
    const plan = argv[2];
    if (!isPlanChoice(plan)) throw new Error(`Usage: npm run tenant-admin -- set-plan <tenantId> ${PLAN_CHOICES.join("|")} [--force]`);
    const changed = await setPlan(db, id, plan, { force: argv.includes("--force") });
    console.log(`${changed.name}: plan ${changed.from} -> ${changed.to}`);
    return;
  }

  if (cmd === "grant-credit") {
    const usd = Number(argv[2]);
    if (argv[2] === undefined || argv[2].startsWith("--") || Number.isNaN(usd)) throw new Error('Usage: npm run tenant-admin -- grant-credit <tenantId> <dollars> [--note "why"] [--force]');
    const g = await grantCredit(db, id, usd, { note: flag("note"), force: argv.includes("--force") });
    console.log(`${g.name}: added $${(g.amountMicros / 1_000_000).toFixed(2)} of AI credit. Credit left: $${(g.leftMicros / 1_000_000).toFixed(2)}`);
    console.log("It can be used once the included AI is switched on (INCLUDED_AI_ANTHROPIC_KEY is set).");
    return;
  }
  if (cmd === "credit") {
    console.log(`${tenant.name}: AI credit left $${((await creditLeftMicros(db, id)) / 1_000_000).toFixed(2)}`);
    return;
  }

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
    throw new Error('Usage: npm run tenant-admin -- list | create "<name>" <admin email> [--plan ...] | set-plan <id> <plan> | grant-credit <id> <dollars> | credit <id> | suspend <id> | resume <id> | extend-trial <id> <days>');
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
