// `npm run db:reset`: drops the database, re-applies the migrations and runs the seed.
// Prisma wipes before the seed's own guard can run, so the same check happens here first.
import "dotenv/config";
import { spawnSync } from "child_process";
import { assertSafeTarget } from "./safe-target";

assertSafeTarget();

const args = process.argv.slice(2).filter((a) => a !== "--force");
const env = { ...process.env, ...(process.argv.includes("--force") ? { WIPE_FORCE: "1" } : {}) };
const run = spawnSync("npx", ["prisma", "migrate", "reset", ...args], { stdio: "inherit", shell: true, env });
process.exit(run.status ?? 1);
