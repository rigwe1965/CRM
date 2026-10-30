// Loads ANTHROPIC_API_KEY for the quality checks from .env.eval (git-ignored) so the key is never typed into a
// command, a chat or a shell history. Import this first in an eval script. A key already in the environment wins.
import { existsSync } from "node:fs";

if (existsSync(".env.eval")) process.loadEnvFile(".env.eval");
