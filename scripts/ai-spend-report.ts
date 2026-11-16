// What the included AI has cost you this month, per business, for checking against Anthropic's bill. Read-only.
//   npm run ai-spend
// Run against the production database (PLATFORM_DATABASE_URL, the owner role, is preferred). Figures are estimated from token
// counts, so they will differ a little from the Anthropic console. Set INCLUDED_AI_ALERT_USD and INCLUDED_AI_ALERT_EMAIL to be
// emailed when the month's total nears a limit you choose.
import "dotenv/config";
import { buildSpendReport, formatSpendReport } from "../src/lib/ai/platform-spend";

buildSpendReport()
  .then((r) => {
    console.log(formatSpendReport(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error("Could not build the report:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
