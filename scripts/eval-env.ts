// Loads ANTHROPIC_API_KEY for the quality checks from .env.eval, or .claude/.env.eval (both git-ignored), so the key is
// never typed into a command, a chat or a shell history. Import this first in an eval script. A key already in the
// environment wins.
import { existsSync } from "node:fs";

for (const file of [".env.eval", ".claude/.env.eval"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
