// Promote an existing user to ADMIN (the first admin in a fresh production database):
//   npm run make-admin -- you@example.com
// Sign up in the app first, then run this against the production DATABASE_URL.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

const db = new PrismaClient();
db.user
  .update({ where: { email }, data: { role: "ADMIN", isActive: true } })
  .then((u) => console.log(`${u.email} is now ADMIN`))
  .catch((e) => {
    console.error(e.code === "P2025" ? `No user with email ${email}. Sign up first.` : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
