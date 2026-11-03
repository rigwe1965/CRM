# Plan: Phase 4, new product features (proposal, for approval)

Status: **proposal only. No code has been changed.** Nothing below starts until the owner approves it, item by item.

## What I found first

The candidates in `NEXT_LEVEL_PLAN.md` were written before I had read the feature docs. Much of them already exists, so
this plan only proposes real gaps. Checked in `TECHNICIAN.md`, `AI_ASSISTANT_PLAN.md` and `src/`:

| Candidate from the first plan        | State today                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Automations                          | **Built:** instalment emails, low-stock alerts, quiet leads, shipping updates, stage tasks (`src/lib/automations/`). |
| Customer-facing invoice / pay links  | **Built:** `/pay`, `/my-order`, `/api/public/my-order`.                                             |
| WhatsApp / email templates           | **Built:** per-business Meta templates, slots, opt-in check. **Not run against the real Meta service** (TECHNICIAN.md says so). |
| Ivy assistant                        | **Built:** Ask Ivy, proposals, instalment schedules, inbox triage, document intake, knowledge base. Auto-reply (Phase 5) deliberately **not** built. |
| Reports                              | **Thin:** `GET /api/reports` returns revenue by month, days to pay, best sellers and lead sources only. |

I have not exhaustively read every screen, so treat "built" as "found in the docs and code", and correct me where the
shop's real experience differs.

## Proposed items, in the order I recommend

### 4.1 Prove what is built against the real services (recommended first)

The WhatsApp template sending, payment reminders and Stripe billing are described as built and tested with fakes, but not
yet run against the real Meta and live Stripe services. Before adding features, a short checklist run with a test number
and Stripe test cards: send each template, receive a webhook, pay an instalment, cancel a subscription. Fix what breaks.
- Effort: about 2-3 days with you available for the Meta side. Risk: low (test numbers, test cards). Code changes: only bug fixes found.

### 4.2 Reports that answer "who owes me money and what is selling"

Today's reports cannot say who is overdue. Proposed, all **per currency, never summed across currencies** and honouring
`ownerScope` (sales users see their own):
- Outstanding balances and **ageing** (current, 1-30, 31-60, 60+ days overdue) by customer and by deal.
- Upcoming instalments for the next 30 days (expected cash in).
- Stock: sell-through per product/colour/length and what is low (reuses `loadStock`).
- Per-salesperson revenue and conversion (admins only).
- CSV export for each (the export routes and audit pattern exist).
- Effort: about 1 week. Risk: low (read-only queries). Uses the new tenant-led indexes; measured with `scripts/perf-baseline.ts` at 40,000 contacts. No schema change expected.

### 4.3 Bulk WhatsApp messages from approved templates

TECHNICIAN.md lists "bulk campaigns" as not built for WhatsApp. Proposed: pick a segment (a saved filter), an approved
template and slot values, preview recipients, send.
- **Hard rules:** only contacts with `whatsappOptIn` ticked; never a template Meta has not approved; a per-business daily cap and
  rate limit; every send audit-logged; a dry-run preview first; stop on repeated provider errors.
- Needs your decision on volumes and Meta's per-number messaging tier. Effort: about 1-2 weeks. Risk: **medium** (messaging customers, spend, account quality). Needs 4.1 first.

### 4.4 Ivy auto-reply (AI Phase 5): recommend deferring

The assistant plan already says this needs its own approval, and the rule "no sending to customers without approval"
stands. I recommend not starting it until 4.1 to 4.3 have run in the real shop for a while. If you want it sooner, I will
write its own plan (business hours, hand-off to a person, topics it may answer, daily cap, an always-visible kill switch).

## What I need from you

1. Approve **4.1** first? (recommended)
2. Approve **4.2** reports? Which of the five report parts matter, and are there reports the shop uses today on paper or in a spreadsheet that I should match?
3. Approve **4.3** later, after 4.1? Roughly how many customers would a single message go to?
4. Confirm **4.4** stays deferred.

Each approved item gets its own short branch, a PR with CI green, and a measured result, as in Phases 1 to 3.
