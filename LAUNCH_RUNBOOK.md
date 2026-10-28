# Launch runbook

The steps the owner does outside the code before real customers use the CRM, in order. Variable names are from `.env.example`; background is in `README.md` ("Do before going live") and `TECHNICIAN.md`. Tick each box as you go.

## 1. Production database

- [ ] Create a separate Production database (not the one Preview uses). Note that `prisma migrate deploy` runs on every Vercel build, so a Preview build pointed at Production would migrate it.
- [ ] In Vercel, scope these to **Production** only: `DATABASE_URL` (the pooled URL, connecting as the restricted role `crm_app`), `DIRECT_URL` and `PLATFORM_DATABASE_URL` (the owner role). Give **Preview** its own throwaway database and its own values.
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
- [ ] Add an uptime monitor on `https://<domain>/api/health` (liveness and database connectivity), with an alert to a phone or email you check.
- [ ] Alert on repeated 5xx from `/api/webhooks/billing`: a failing billing webhook leaves businesses on the wrong plan.
- [ ] Check the daily cron ran (Vercel, Cron) after the first day. It sends task reminders and runs business erasure.

## 9. Repository hygiene

- [ ] GitHub: Settings, Code security, turn on secret scanning, push protection and Dependabot alerts.
- [ ] Run `npm audit --omit=dev` and note the result. Repeat regularly.

## 10. Things that need other people

- [ ] Terms of service, privacy policy and data-processing agreement (a lawyer). Then add the sign-up checkbox and legal pages.
- [ ] An independent tenant-isolation review, ideally with a short external penetration test.

## Last check before opening sign-up

- [ ] `/api/health` is green on the live domain.
- [ ] `npm run tenant-admin -- list` shows only the businesses you expect.
- [ ] You can sign in as the original (`internal`) business and its data is intact.
- [ ] A backup restore has been tried at least once on a copy.
