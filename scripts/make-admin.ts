// Promote a user to ADMIN (the first admin in a fresh production database):
//   npm run make-admin -- you@example.com            promote an existing user
//   npm run make-admin -- you@example.com --create "Your Name"   create the user if missing
// Public sign-up is closed, so use --create for the very first admin, then set a password with
// "Forgot password" on the sign-in page. Run this against the production DATABASE_URL.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const email = args[0]?.trim().toLowerCase();
const createAt = args.indexOf("--create");
const name = createAt === -1 ? undefined : args[createAt + 1]?.trim() || email?.split("@")[0];
if (!email || email.startsWith("--")) {
  console.error('Usage: npm run make-admin -- <email> [--create "Name"]');
  process.exit(1);
}

const db = new PrismaClient();
const run = name
  ? db.user.upsert({
      where: { email },
      update: { role: "ADMIN", isActive: true },
      create: { email, name, role: "ADMIN" },
    })
  : db.user.update({ where: { email }, data: { role: "ADMIN", isActive: true } });

run
  .then((u) => console.log(`${u.email} is now ADMIN`))
  .catch((e) => {
    console.error(e.code === "P2025" ? `No user with email ${email}. Re-run with --create "Name".` : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
