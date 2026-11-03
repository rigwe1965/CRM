# Phase 4.1: proving the integrations against the real services

Status: **in progress.** Goal: run each integration once against the real provider in **test mode**, and write down what
happened. Everything here was built and tested with fakes; this is the first run against the real services.
Rule: test mode, a test phone number, test cards. No real customer is messaged and no real card is charged.

Where each check can be run:
- **Me (Claude):** the parts that need only the repo, the Stripe CLI and the local dev server.
- **You:** anything that needs the Meta business account, a phone that receives WhatsApp, or a signed-in browser.

Results go in the "Result" column; fix what fails, then re-run it.

## A. Stripe (test mode: the key in `.env` is `sk_test_…`)

| # | Check | How | Who | Result |
|---|---|---|---|---|
| A1 | Webhook rejects a bad signature | `stripe listen --forward-to localhost:3001/api/webhooks/stripe`, then POST to it without a valid signature: expect 400 | Claude | |
| A2 | Create a payment link on a sample USD deal | Deal → Payments → create link (test mode) | You (signed in) | |
| A3 | Pay it with `4242 4242 4242 4242` | Open the link, any future date and CVC | You | |
| A4 | The payment appears once | Deal shows the payment; audit log has `payment.recorded_online`; a repeat event does not add a second payment (idempotent on `providerRef`) | Claude + You | |
| A5 | A payment that cannot be recorded is not lost | Cancel the link or drop the balance, then pay: expect link `REFUND_NEEDED` and an URGENT task | You | |
| A6 | Subscription billing | Sign-up checkout with a billing test price, then cancel; business plan and status follow (`BILLING_STRIPE_*` keys, `/api/webhooks/billing`) | You | |

Data warning: A2 to A5 create real rows in the **local dev database** (a payment on a sample deal). Use a deal named
"Sample …" and delete or note it afterwards (CLAUDE.md: seed data stays as the newcomer sample unless asked).

## B. WhatsApp (Meta Cloud API) : needs your Meta account

Needs in `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN` (none are set on this machine today). The webhook address is
`https://<public-url>/api/webhooks/whatsapp`; locally that needs a tunnel.

| # | Check | How | Who | Result |
|---|---|---|---|---|
| B1 | Meta verifies the webhook | Save the webhook in Meta with the verify token; the app answers the one-time challenge | You | |
| B2 | A bad signature is refused | POST to the webhook with a wrong `X-Hub-Signature-256`: expect rejection | Claude | |
| B3 | Template sync | Settings → Templates → "Refresh from Meta": templates and statuses appear; only APPROVED and supported ones switch on | You | |
| B4 | Send a template to your own test number | Contact (opt-in ticked, WhatsApp-ready number) → Send template; arrives on the phone | You | |
| B5 | Delivery status comes back | Delivered / read states show against the message | You | |
| B6 | An inbound message is filed | Reply from the phone; it appears on the contact (or in the inbox for an unknown number) | You | |
| B7 | Payment reminder in Test mode | Reminders in Test mode go only to the test number | You | |

## C. Email (Resend)

| # | Check | How | Who | Result |
|---|---|---|---|---|
| C1 | A reminder email is delivered | Needs `RESEND_API_KEY` and `EMAIL_FROM` (empty on this machine); Send reminder now in Test mode to your own address | You | |

## What I need from you to continue

1. Which parts can you do now: Stripe (a signed-in browser on the dev server), WhatsApp (Meta credentials and a test phone), email (a Resend key)?
2. May I run the dev server on port 3001 and use `stripe listen` (A1 only needs these, no data changes)?
3. For A2 to A5: which local deal may take a test payment?
