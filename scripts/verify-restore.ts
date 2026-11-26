// Prints row counts for the main tables of any database, to prove a restore matches the original.
//   npm run db:verify -- "<live url>" "<restored url>"     compares the two and exits 1 on any difference
//   npm run db:verify -- "<url>"                           just prints the counts
// Read-only. Uses the owner role, so row-level security does not hide rows from the count.
import { createPrismaClient } from "../src/lib/prisma-client";

const TABLES = ["Tenant", "User", "Contact", "Organization", "Deal", "DealItem", "Payment", "PaymentLink", "Instalment", "Invoice", "Activity", "Task", "AuditLog"];

async function counts(url: string) {
  const prisma = createPrismaClient({ url: url });
  try {
    const out: Record<string, number> = {};
    for (const t of TABLES) {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`);
      out[t] = Number(rows[0].n);
    }
    return out;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const [a, b] = process.argv.slice(2);
  if (!a) throw new Error('Usage: npm run db:verify -- "<url>" ["<restored url>"]');
  const first = await counts(a);
  if (!b) return console.table(first);
  const second = await counts(b);
  const rows = TABLES.map((t) => ({ table: t, live: first[t], restored: second[t], match: first[t] === second[t] ? "ok" : "DIFFERENT" }));
  console.table(rows);
  if (rows.some((r) => r.match !== "ok")) {
    console.error("The restored database does not match. Do not rely on this backup.");
    process.exit(1);
  }
  console.log("Counts match.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
