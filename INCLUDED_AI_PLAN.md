# Plan: "included AI" billing (proposal, for decisions before any code)

Status: draft, 2026-11-16. Nothing here is built. It needs the owner's decisions in section 5.

## 1. Where we are

| Piece | Today | Where |
|---|---|---|
| Who pays Anthropic | Each business brings its own key (stored encrypted, write-only). The original business may use the server key. | `src/lib/ai/client.ts` |
| Which model | Each business picks Haiku 5.5, Sonnet 5.5 (default) or Opus 5.5 | `src/lib/ai/models.ts`, Settings > AI assistant |
| Spend control | Monthly ceiling per business (admin sets it; AI is off until set), checked before every model call, priced per model | `src/lib/ai/usage.ts`, `status.ts`, `pricing.ts` |
| Spend record | `AiUsage` row per call: model, tokens, estimated cost, purpose | `prisma/schema.prisma` |
| Product billing | Stripe subscriptions: Free trial, Starter, Pro, with limits, read-only when unpaid, customer portal, webhook | `src/lib/plans.ts`, `billing.ts`, `stripe-webhook.ts` |

So a customer who buys the CRM and adds their own Anthropic key already works end to end. What is missing is a way to **earn money from AI itself** and a way for customers **without an Anthropic account** to use AI.

## 2. What it costs us (measured 2026-11-16, real calls)

Anthropic list prices per million tokens (input / output): Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20.

| One WhatsApp triage call (the CRM's real request) | Haiku | Sonnet | Opus |
|---|---|---|---|
| Estimated cost | $0.0005 | $0.0073 | $0.0146 |

The app's own screens estimate a supplier-document read at 2 to 6 cents on Sonnet and a WhatsApp message help at one to two cents. These are small per action, but a busy shop does hundreds a month, and Opus costs about twice Sonnet. Prices above are Anthropic's; **what we charge is the owner's decision** (section 5).

## 3. The options

### A. Bring your own key only (today)
Customers pay Anthropic directly. We earn from the CRM plan only.
- For: no AI cost or risk for us; nothing to build.
- Against: no AI revenue; customers without an Anthropic account cannot use AI.

### B. Included allowance (capped)
Each plan includes a monthly AI allowance in dollars, spent on **our** key. When it is used up, AI pauses until next month, or the customer adds their own key, or buys more (option D).
- *Example 1:* Starter includes $3 of AI a month. A shop on Haiku does a few thousand small actions and never notices. On Sonnet, about 400 triage calls would use it up.
- *Example 2:* Pro includes $15. A team doing document reads on Sonnet (about 4 cents each) gets roughly 375 reads.
- For: simple to explain; worst-case cost per customer is known in advance; reuses the existing ceiling.
- Against: some customers hit the cap; a low-use customer pays for allowance they do not use.

### C. Metered pay-as-you-go (billed afterwards)
We record usage and bill cost plus a markup at the end of the month through Stripe metered billing.
- *Example:* a customer uses $20 of Opus, we invoice $50 (2.5 times cost).
- For: fair to heavy and light users; highest revenue per heavy user.
- Against: we carry the risk until the invoice is paid (a failed card after the AI was already used is a loss); bill shock; more to build (usage reporting, disputes, tax lines).

### D. Prepaid credits (top-ups)
Customers buy credit packs (for example $10 or $25) with a one-time Stripe payment. AI spends the credit; at zero it pauses.
- *Example 1:* a customer buys a $10 pack, uses it over two months on Sonnet.
- *Example 2:* a heavy user buys a $25 pack every month.
- For: no arrears risk; the customer is always in control; easy to explain.
- Against: customers must remember to top up (can add "auto top-up" later); unspent credit needs a clear expiry and refund rule.

## 4. Recommendation

**B + D, with A kept.** Each plan includes a small capped allowance (B); customers who want more buy credit packs (D); customers who already have an Anthropic account can still bring their own key (A) and pay nothing to us for AI. Skip C for now: it is the only option where we can lose money after the fact.

Why it fits what exists: the monthly ceiling, the per-call cost record and the Stripe subscription are already there. The new parts are small:

1. **Whose key.** `anthropicFor(tenantId)` uses the business's own key if saved, otherwise our platform key **only when** the plan includes AI or the business has credit. Without either, today's "add a key" message stays.
2. **A balance.** A new ledger (credit in, usage out) per business, plus the plan allowance that resets monthly. The ceiling check becomes: stop when allowance + credit is used up, or the admin's own ceiling is reached, whichever comes first. (This needs a database migration: ask first.)
3. **Stripe.** One-time Checkout for credit packs; the existing webhook adds the credit once per payment (idempotent on the Stripe event id, so a replay cannot add it twice).
4. **Screens.** Settings > AI assistant shows "Included this month: used / total", "Credit left", a "Buy credit" button, and keeps the key option.
5. **Guard rails.** A hard monthly spending limit on our Anthropic key (in the Anthropic console), an alert when platform spend passes a threshold, and included AI limited to Haiku and Sonnet unless the plan or credit explicitly allows Opus.

Build order, each step its own PR, each safe to ship alone: (1) the ledger and the balance check with no payments yet, used by the original business as a test; (2) allowances per plan; (3) credit packs through Stripe; (4) screens and emails ("80% used", "credit low").

## 5. Decisions needed from the owner

1. **Approach:** B + D (recommended), D only, B only, or something else?
2. **Prices (yours to set; no price is assumed here):** the dollar allowance in each plan (Starter, Pro); the credit pack sizes and what they cost the customer. A simple rule to start from: customer price = our Anthropic cost x a markup you choose, rounded to a clean amount.
3. **Models on included AI:** Haiku and Sonnet only (recommended), or Opus too (it uses the allowance about twice as fast as Sonnet)?
4. **Expiry:** do credits expire (for example after 12 months) and are they refundable?
5. **Tax and terms:** `BILLING_AUTOMATIC_TAX` is still off until Stripe Tax is ready (see `LAUNCH_RUNBOOK.md`); selling credit packs needs the same answer. The privacy policy (`src/lib/legal-content.ts`) currently says Anthropic runs the assistant "through the business's own account"; that sentence becomes untrue under included AI and must be reworded (AI may run on our account) before any customer uses it.
6. **Other projects:** RECI, ClaudeOS and RMM are single-customer per deployment today. Billing for them is a separate decision (a per-deployment licence is simpler than metering).

## 6. Risks to watch

- **Unpaid usage:** options B and D cap exposure by design; only C creates it.
- **Key leak or abuse of our key:** hard spending limit at Anthropic, per-business ceilings, rate limits (already in place).
- **Estimates are not invoices:** costs come from token counts; reconcile monthly against Anthropic's bill and keep a safety margin in prices.
- **Model price changes:** the price table lives in one file (`pricing.ts`); update it when Anthropic changes prices, and re-check the allowance sizes.
