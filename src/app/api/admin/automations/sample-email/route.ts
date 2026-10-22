import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { sampleEmailSchema } from "@/lib/automations/config";
import { customerInstalmentEmail } from "@/lib/email-templates";
import { mailIsConsoleOnly, trySendMail } from "@/lib/mail";
import { senderFor } from "@/lib/sender";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// Outgoing mail must always reach the provider (see the cron route).
export const fetchCache = "force-no-store";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How the sample is dated, so each notice reads the way a real one would. */
const SAMPLE_DUE_IN_DAYS = { UPCOMING: 2, OVERDUE_1: -1, OVERDUE_2: -7 } as const;

/**
 * POST /api/admin/automations/sample-email: sends one sample customer reminder, with made-up details, to
 * the address given, so an admin can check the wording and the delivery without waiting for the daily run.
 * Body: { to, brandName, kind }. Reads and records nothing about real customers, deals or instalments.
 * `consoleOnly` is true when no email provider is configured (development): the email was only printed
 * in the server window and was not delivered.
 */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, sampleEmailSchema);
  await enforceRateLimit(`sample-email:${user.id}`, LIMITS.sendEmail);

  await assertUnderDailyCap(user.tenantId, "emails");
  const dueDate = new Date(Date.now() + SAMPLE_DUE_IN_DAYS[body.kind] * DAY_MS);
  const mail = customerInstalmentEmail({
    brand: body.brandName,
    firstName: "Adaeze",
    dealTitle: "Sample order",
    amountDue: 100,
    currency: "USD",
    dueDate,
    daysLate: Math.max(0, -SAMPLE_DUE_IN_DAYS[body.kind]),
    kind: body.kind,
    testNote: "This is a sample with made-up details. Nothing was recorded and no customer was emailed.",
  });
  const sent = await trySendMail({
    to: body.to,
    subject: `[SAMPLE] ${mail.subject}`,
    text: mail.text,
    html: mail.html,
    replyTo: user.email ?? undefined,
    from: await senderFor(user.tenantId, body.brandName),
  });
  if (!sent) throw new ApiError(502, "The email could not be sent. Check the email settings and try again.", "EMAIL_FAILED");
  return ok({ to: body.to, consoleOnly: mailIsConsoleOnly() });
}, "ADMIN");
