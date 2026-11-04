# Launch runbook

The steps the owner does outside the code before real customers use the CRM, in order. Variable names are from `.env.example`; background is in `README.md` ("Do before going live") and `TECHNICIAN.md`. Tick each box as you go.

## 1. Production database

- [ ] Production database host: Neon, AWS Europe (Frankfurt, `eu-central-1`). `vercel.json` pins the app's functions to `fra1` (Frankfurt) so they run next to it; if you ever move the database, change `regions` there too.
- [ ] Create a separate Production database (not the one Preview uses). Note that `prisma migrate deploy` runs on every Vercel build, so a Preview build pointed at Production would migrate it.
- [ ] In Vercel, scope these to **Production** only: `DATABASE_URL` (the pooled URL, connecting as the restricted role `crm_app`), `DIRECT_URL` and `PLATFORM_DATABASE_URL` (the owner role). Give **Preview** its own throwaway database and its own values.
- [ ] Create `crm_app` with a login (`ALTER ROLE crm_app LOGIN PASSWORD '…'`, or `CREATE ROLE` if the owner role can't) **before the first `migrate deploy`**, so every migration's grants to it apply. If it was created afterwards, run the grants listed in `TECHNICIAN.md` (Row-level security).
- [ ] Turn on automatic backups and point-in-time recovery at the database provider. Choose a retention period. 30 days matches the deletion grace period, and the privacy policy should say that backups keep older copies until they expire.
- [ ] Check that row-level security is in place on the Production database (`TECHNICIAN.md`, Phase 2) before the first customer signs up.

## 2. Secrets

Generate each with `openssl rand -base64 32`, and set them on Production only.

- [ ] `NEXTAUTH_SECRET`
- [ ] `CRON_SECRET` (Vercel Cron sends it as a Bearer token to `/api/cron/*`)
- [ ] `MFA_ENCRYPTION_KEY`: set this **before any admin enrols in two-step verification**. Without it the two-step secrets are derived from `NEXTAUTH_SECRET`, which then can't be rotated without resetting everyone's two-step setup.
- [ ] If any of these values was ever pasted into chat, email or a shared doc, replace it now. Rotating `NEXTAUTH_SECRET` signs everyone out, so it is cheapest before launch.
- [ ] Set `NEXTAUTH_URL` to the live domain.

## 3. Rate limits

- [ ] Create an Upstash Redis database and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (required in production). Without them, rate limits and the daily email and WhatsApp caps count per server instance only.

## 4. Email

- [ ] Set `RESEND_API_KEY` and `EMAIL_FROM` (an address on a domain you verify).
- [ ] In Resend, add your sending domain and publish the SPF and DKIM records it shows, at the company that runs your DNS. Wait until Resend shows the domain as verified.
- [ ] Add a DMARC record at `_dmarc.<your-domain>`. Start with `v=DMARC1; p=none; rua=mailto:<an address you read>`, and move to `quarantine` once mail passes consistently.
- [ ] Send yourself a test: invite a user, and request a sign-in link. Check both land in the inbox, not spam.
- [ ] Check that your Resend plan allows enough domains if businesses will add their own sender address.

## 5. Billing (the platform's Stripe account, live mode)

- [ ] In the live Stripe account, create the Starter and Pro prices. Set `BILLING_PRICE_STARTER` and `BILLING_PRICE_PRO` to their price ids.
- [ ] Set the real prices and limits in `src/lib/plans.ts` (the numbers there are placeholders). That is a code change, so it needs an approved plan.
- [ ] Set `BILLING_STRIPE_SECRET_KEY` to the live key.
- [ ] Add the webhook endpoint `https://<domain>/api/webhooks/billing` for `customer.subscription.created`, `.updated` and `.deleted`. Set `BILLING_STRIPE_WEBHOOK_SECRET` to its signing secret.
- [ ] Turn on the customer portal in Stripe (it is where businesses change their card or cancel). In its settings let customers update their billing address and tax ID.
- [ ] Sell worldwide: add **currency options** to each price in Stripe (the currencies in `BILLING_CURRENCIES`, `src/lib/billing.ts`). Keep one price per plan; do not create a separate price for each currency, because the plan is recognised by its price id. Checkout picks the buyer's currency, and a business that has subscribed stays in it.
- [ ] Switch on **Stripe Tax** in Stripe: enter the head-office address, add a tax registration for each place where you must collect tax (Stripe calculates and collects tax; it does not register you or file returns, so ask an accountant where you need to), give both products a SaaS tax code, and set each price's tax behaviour (exclusive adds tax on top; inclusive includes it). Test in test mode first.
- [ ] Only after that, set `BILLING_AUTOMATIC_TAX=1` on Production. Before Stripe Tax is ready, leave it unset: with it on, Stripe refuses checkout.
- [ ] Set `TRIAL_DAYS` if you want something other than 14.

## 6. Sign-up and CAPTCHA

- [ ] In Cloudflare (dash.cloudflare.com, Turnstile) create a widget for your domain. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
- [ ] Set `SIGNUP_ENABLED=1` only when everything above is done. The app refuses to start with sign-up on and no Turnstile secret.
- [ ] Run one real sign-up on the live site: confirm the email, subscribe with a real card (refund it afterwards), then cancel.
- [ ] Website lead forms already pasted on sites keep working without the CAPTCHA. For the CAPTCHA to protect them, each site owner has to re-paste the new code from Settings, Lead form.

## 7. Admins and two-step verification

- [ ] `REQUIRE_ADMIN_MFA` is on by default in production. Leave it on.
- [ ] Each admin signs in once and enrols under Settings, Security (until then they have a Sales-level session). Have them save their recovery codes.
- [ ] If an admin is locked out: `npm run make-admin -- <email> --reset-mfa`.

## 8. Monitoring

- [ ] Add error monitoring (Sentry, or Vercel log drains).
- [ ] Add an uptime monitor on `https://<domain>/api/health` (liveness and database connectivity), with an alert to a phone or email you check. Steps are under "Setting up the monitors" below.
- [ ] Set `SUPPORT_EMAIL` (and `SECURITY_EMAIL` if different) and `STATUS_PAGE_URL`. They appear on the sign-in pages and in the user menu, and `/.well-known/security.txt` exists once an address is set. Open that URL to check it.
- [ ] Alert on repeated 5xx from `/api/webhooks/billing`: a failing billing webhook leaves businesses on the wrong plan.
- [ ] Check the daily cron ran (Vercel, Cron) after the first day. It sends task reminders and runs business erasure.

### Setting up the monitors

Use any hosted monitor (Better Stack, UptimeRobot, Pingdom). You need two checks and one page:

1. **Public check, every 1 to 3 minutes.** `GET https://<domain>/api/health`. It must answer 200 with `{"status":"ok"}`. A 503 means the database cannot be reached. Alert by SMS or phone call, not only email.
2. **Private check, every 15 minutes.** `GET https://<domain>/api/health?deep=1` with the header `Authorization: Bearer <CRON_SECRET>`. It answers 503 when the daily job has not worked for 26 hours (reminders, erasures and campaigns have stopped). A monitor that cannot send headers cannot do this one; pick one that can.
3. **Status page.** Create a public status page from the public check, set `STATUS_PAGE_URL` to its address, and redeploy.
4. **Test it.** In staging, point the public check at a wrong path or stop the app and confirm an alert reaches your phone within a few minutes. For the private check, run `GET /api/health?deep=1` with a wrong token and confirm it answers 401, then call the cron endpoint once and confirm it answers 200.
5. **Write down** who gets the alert, and what they do first (check the host, then the database, then the latest deploy).

### Legal documents

- [ ] Set `LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS` and `LEGAL_GOVERNING_LAW`. Open `/terms`, `/privacy` and `/dpa` and send them to a lawyer. Every `[...]` in the text (the database host and region, the transfer mechanism) must be filled in or removed by the reviewer; edit `src/lib/legal-content.ts` and the pages.
- [ ] Check the provider list in `src/lib/legal-content.ts` matches what you really use. Add any new provider there the day you start using it.
- [ ] Only after sign-off, set `LEGAL_REVIEWED=1`. This removes the draft notice from the pages.
- [ ] If the wording changes in a way customers must agree to, change `LEGAL_VERSION` in `src/lib/legal.ts`: every business's admin is then asked to accept again.
- [ ] For a pilot business you create yourself, its admin sees a banner on first sign-in and accepts there. Check the audit log shows `legal.accepted` before you load real customer data.

## 9. Repository hygiene

- [ ] GitHub: Settings, Code security, turn on secret scanning, push protection and Dependabot alerts.
- [ ] Run `npm audit --omit=dev` and note the result. Repeat regularly.

## 10. Things that need other people

- [ ] Terms of service, privacy policy and data-processing agreement (a lawyer). Then add the sign-up checkbox and legal pages.
- [ ] An independent tenant-isolation review, ideally with a short external penetration test.

## Last check before opening sign-up

- [ ] `/api/health` is green on the live domain.
- [ ] `npm run tenant-admin -- list` shows only the businesses you expect.
- [ ] To onboard a pilot without opening public sign-up: `npm run tenant-admin -- create "<shop name>" <admin email> --plan starter`, then send the printed link. Check the audit log later shows `legal.accepted` for that business.
- [ ] You can sign in as the original (`internal`) business and its data is intact.
- [ ] Settings > System shows no red lines; `HEALTHCHECK_PING_URL` and an uptime monitor on `/api/health?deep=1` are set (TECHNICIAN.md, "Is the daily job running?").
- [ ] The weekly "Restore drill" workflow has been run once from the Actions tab and passed; branch protection on `master` requires the `security` and `verify` jobs.
- [ ] A backup restore has been tried at least once on a copy.
