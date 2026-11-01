# When a pilot shop reports a problem

One page for whoever answers `SUPPORT_EMAIL`. Promise pilots a reply within one business day.

## First reply (within the hour if you can)

1. Say you have it, and ask for: what they were doing, what they expected, what happened, the time, and a screenshot.
2. Never ask for a password or an authenticator code. If they offer one, tell them not to share it.

## Find out how bad it is

| Looks like | Do this |
| --- | --- |
| Nobody can sign in, or pages error for everyone | Check the status monitor and the hosting dashboard (Vercel, Logs). Treat as an outage: tell all pilots now. |
| One shop sees another shop's data | **Stop.** Remove the affected business's access (suspend it with `npm run tenant-admin`), tell the owner, and follow the security steps below. |
| Money is wrong (a payment missing, a balance off) | Open Reports → Reconcile as an admin of that business. Do not edit payments by hand until you know why. Check the audit log for the deal. |
| A customer was messaged or emailed by mistake | Find the activity on the contact, stop any running campaign (Settings → Campaigns → Stop), and tell the shop owner. |
| Something is slow or looks odd | Ask for the page and time, check the error report (Sentry) around that time. |
| A user is locked out | An admin can reset their two-step verification (Settings → Team). If the only admin is locked out: `npm run make-admin -- <email> --reset-mfa`. |

## Security reports

- A report from outside arrives at `SECURITY_EMAIL` (see `/.well-known/security.txt`). Reply within two business days, thank them, and do not threaten legal action over good-faith reports.
- If customer data may have been exposed: write down what, when and for whom; stop the cause; tell the affected shops promptly and in plain words. Some countries require telling the regulator within 72 hours.
- Rotate any secret that may have leaked (see the "Secrets" list in `LAUNCH_RUNBOOK.md`).

## After every incident

Write three lines: what happened, how it was fixed, what stops it happening again. Keep them in one file so the pattern is visible.
