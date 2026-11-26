// Promote a user to ADMIN (the first admin in a fresh production database):
//   npm run make-admin -- you@example.com            promote an existing user
//   npm run make-admin -- you@example.com --create "Your Name"   create the user if missing
//   npm run make-admin -- you@example.com --tenant <tenantId>   the business a new user joins (default: the original business)
//   npm run make-admin -- you@example.com --reset-mfa   also switch off their two-step verification
//                                                         (the only admin lost their phone)
// Public sign-up is closed, so use --create for the very first admin, then set a password with
// "Forgot password" on the sign-in page. Run this against the production DATABASE_URL.
import "dotenv/config";
import { createPrismaClient } from "../src/lib/prisma-client";
import { DEFAULT_TENANT_ID } from "../src/lib/tenant";

const args = process.argv.slice(2);
const email = args[0]?.trim().toLowerCase();
const createAt = args.indexOf("--create");
const name = createAt === -1 ? undefined : args[createAt + 1]?.trim() || email?.split("@")[0];
if (!email || email.startsWith("--")) {
  console.error('Usage: npm run make-admin -- <email> [--create "Name"]');
  process.exit(1);
}

const tenantAt = args.indexOf("--tenant");
const tenantId = tenantAt === -1 ? DEFAULT_TENANT_ID : args[tenantAt + 1]?.trim();
if (!tenantId) {
  console.error("--tenant needs a tenant id");
  process.exit(1);
}

const resetMfa = args.includes("--reset-mfa");
// Also ends their existing sessions, like the admin "Reset two-step verification" button.
const mfaReset = resetMfa
  ? { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [], passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 1000) }
  : {};

// The owner connection when there is one: the restricted app role (DATABASE_URL) cannot see users outside a business.
const db = createPrismaClient({ url: process.env.PLATFORM_DATABASE_URL || undefined });
const run = name
  ? db.user.upsert({
      where: { email },
      update: { role: "ADMIN", isActive: true, ...mfaReset },
      create: { email, name, role: "ADMIN", tenantId },
    })
  : db.user.update({ where: { email }, data: { role: "ADMIN", isActive: true, ...mfaReset } });

run
  .then((u) => console.log(`${u.email} is now ADMIN`))
  .catch((e) => {
    console.error(e.code === "P2025" ? `No user with email ${email}. Re-run with --create "Name".` : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
