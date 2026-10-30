# Ivy: the CRM's AI assistant

Plan agreed with the owner. Phase 0 and Phase 1 are in scope; later phases need their own approval.

## Decisions (owner, 2026-10-30)

| Question | Decision |
| --- | --- |
| Model | `claude-sonnet-5-5` ($2 / $10 per million tokens). Effort starts at `medium`; tune from the eval set. |
| Whose API key | Each business brings its own (stored like the Stripe and WhatsApp keys: encrypted, write-only). The original business may use the `ANTHROPIC_API_KEY` environment variable until it saves its own. |
| Who can use it | All roles. Ivy always acts as the signed-in user: SALES and SUPPORT see their own records, admins their whole business. |
| Name and language | "Ivy", English only. |
| Spend ceiling | A monthly ceiling per business, enforced by us from token counts. **No default amount**: an admin must set one before Ivy runs. |
| Retention | Conversations are purged after 90 days (`AI_RETENTION_DAYS`). Users can delete their own earlier. |
| Read-only workspaces | Chat keeps working (like reading and export). |
| Dependency | `@anthropic-ai/sdk` approved. |

## What other CRMs do, and what we took

- Salesforce Agentforce: a fixed set of named actions, guardrails, an audit trail of what the AI did.
- HubSpot Breeze: review-before-send by default, an autonomy setting per action type.
- Attio "Ask Attio", Zoho Zia: a chat assistant that acts with the user's own permissions and asks before changing data.
- Microsoft Dynamics 365: proposals the human approves before anything is written.
- Prompt injection (customer text such as WhatsApp messages and web-form enquiries is untrusted): least privilege,
  separate reading from acting, human confirmation for anything that sends or changes data, show the real action.

## Rules that do not change

- The AI only proposes. Anything that changes data or contacts a customer goes through the same validated server code
  the screens use, as the signed-in user (`authed()`, `ownerScope`, row-level security, audit log).
- Ivy never does money arithmetic. Totals come from tools, per currency, never summed across currencies.
- Customer text reaches the model only as quoted data. No write tools and no sending in Phase 1.
- The chat renders text only: in-app links, no images, no external URLs (closes the image-URL data-leak trick).
- Messages are stored verbatim (the model's thinking blocks are tied to the conversation), so old turns are never
  edited or summarised. A long chat ends and a new one starts.

## Phase 0: foundations

- `@anthropic-ai/sdk`; integration kind `ANTHROPIC` (encrypted, write-only, checked with one tiny call on save).
- Tables `AiConversation`, `AiMessage`, `AiUsage` (RLS like every business table); settings under the
  `assistant` key of `AutomationSetting` (`enabled`, `monthlyCeilingUsd`; off, and no ceiling, by default).
- Cost: price table, estimated cost per model call, month-to-date spend, a ceiling check before every call
  (warning at 80%, stop at 100%), a per-user rate limit.
- Retention purge in the daily cron; the new tables in business erasure. (Adding conversations and usage to the full data
  export waits for Phase 1, when there are conversations to export; it has its own security tests.)
- Admin screen "Ivy": key status, on/off, ceiling, month-to-date spend, and a note that questions and the records Ivy
  looks up go to Anthropic under the business's own key.

## Phase 1: Ask Ivy (read-only): built

Decisions taken when the owner approved the build without answering the five open questions (the plan's own recommendations):
effort starts at `low`; Anthropic's server-side fallback is on; the tools are the eleven in `src/lib/ai/tools/index.ts`; the data export carries
spend records and chat metadata only (no titles, no text); an answer is limited to 50 seconds and 6 tool rounds, held in
`DEADLINE_MS` and `MAX_ROUNDS`, to be tuned to the hosting plan.

A streaming loop (hand-written, so every iteration is metered), eleven read-only tools wrapping existing scoped code
(contacts, deals and payments, overdue instalments, stock, cash flow, reports, Money checks, tasks, supplier invoices), a
side panel opened from the header or Ctrl/Cmd+K, injection and tenant-isolation tests, and a 43-question eval script
(`scripts/ivy-eval.ts`) that runs against a real key. Each real run spends money, so it needs approval and a budget; its
`--dry-run` is free. The real eval has not been run yet.

## Phase 2: proposals (Ivy suggests, you approve): built

The owner approved the plan below with "use your recommendations": shared functions (Option 1), Wave A as listed, the admin
switch off by default, 24 hours and 10 per chat, Wave B as a separate later approval. Differences from the plan as written:
a batch is shown as a group of cards with per-card Approve and an "Approve all" button (not one card with tick boxes), and
"Approve all" skips any card that carries a warning, such as closing a deal. The limit of 10 is on cards waiting per chat
(plus 30 per person). The eval now has 58 questions and ends by checking the business is exactly as it was. Details:
TECHNICIAN.md, "Proposed actions".

Goal: Ivy can say "I'll set that up" and put a card in the chat. Nothing changes until the person presses **Approve**. Ivy
still has no way to write or send anything itself.

### How it works

1. Ivy calls a `propose_*` tool. The tool checks the input with the same Zod schema, and the same scope checks
   (`ownerScope`, `assertLinks`, `resolveOwner`), the screen would use, then saves a row in a new table `AiProposal` with the
   exact parameters. It writes no business data. Its result tells Ivy "queued for approval, nothing has been done yet", so
   Ivy cannot claim it was done.
2. The panel shows a card built **from the saved parameters** (never from Ivy's wording): what will happen, to which
   contact or deal, with every value spelled out (amount and currency, due date, new stage). Buttons: Approve, Edit (change
   a value before approving), Decline.
3. Approve runs the action as the signed-in person through the same server code as the screen: validation, row-level
   security, audit log. The audit entry says it came from Ivy and names the proposal. Ivy is told the outcome on the
   person's next message.
4. Rules: a card can be decided once (second click is a no-op); it expires after 24 hours; it is re-checked at approval
   (the deal was deleted, the stage already changed, the task already done: the card says so and does nothing). A person
   can only see and decide their own proposals. In a read-only workspace the card cannot be approved (same block as every write).

### What Ivy can propose

Wave A (this phase):

| Tool | Does on approval | Uses |
| --- | --- | --- |
| `propose_task` | Create a task (title, due date, priority, linked contact or deal; assignee is the person, or someone else only if they are an admin) | `POST /api/tasks` logic |
| `propose_task_update` | Complete, reopen or reschedule a task | `PATCH /api/tasks/:id` logic |
| `propose_note` | Log a note, call or meeting on a contact or deal | `POST /api/activities` logic |
| `propose_stage_change` | Move a deal to a stage. Closing won or lost shows an extra warning line (it sets 100% or 0% and triggers the stage automations and notifications) | `POST /api/deals/:id/stage` logic |
| `draft_message` | Shows a ready-to-send WhatsApp or email text in a card with a Copy button and a link to the contact's existing send box. **Ivy never sends.** | no write |

Batches: "make a task for each overdue instalment" becomes one card with a row per item (at most 10) that can each be
ticked off, not ten cards.

Wave B (a separate approval, after A has run for a while): record a payment, create a contact or deal. Money moves, so
they get the strictest card (amount, currency, deal, instalment it will clear) and their own eval cases.

Not in Phase 2: sending anything to a customer, deleting anything, merging contacts, changing prices, stock or invoices, and
inbound message handling.

### How the shared code is reused (decision needed)

The write logic today sits inside the route handlers. Two ways to run it on approval:

- **Option 1 (recommended): move each action's logic into a small function** (for example `createTask(user, input)`) that
  both the route and the approval use. The routes behave the same; their existing tests prove it. One extra refactor per
  action, but approval is atomic with marking the proposal APPLIED, and there is a single code path to audit.
- Option 2: the browser calls the existing route on Approve, and a header links it to the proposal. No refactor, but
  "applied" is recorded in a second step and can drift if the page is closed between the two.

### Safety

- Proposals are the only write path Ivy has, and the person decides every one. No autonomy setting in this phase.
- Customer-written text (WhatsApp messages, web-form enquiries, notes) is still only data to the model. If hostile text
  tricks Ivy into proposing something odd, the person sees the real action on the card and can decline; they never
  approve "Ivy's description", only the saved values. The card renderer shows plain text only (same renderer as the chat).
- A new admin switch **"Let Ivy propose actions"**, off by default, so businesses opt in after seeing read-only Ivy work.
- Proposals count against the same monthly spend ceiling (no new model call is made on approve).
- Tools and the instructions change, so `IVY_PROMPT_VERSION` goes to 2 and the pin in `tests/ai-prompt.test.ts` is updated.
  Chats open before the release become read-only and the panel says to start a new chat (already built for this).

### Changes

- Migration (hand-written SQL, RLS, `crm_app` grants): table `AiProposal` (id, tenantId, userId, conversationId, kind, params
  JSON, summary, status PENDING / APPLIED / DECLINED / EXPIRED / FAILED, resultEntity, resultId, createdAt, decidedAt,
  expiresAt) and the assistant setting `proposalsEnabled`. Purged with the conversation (90 days) and added to business
  erasure.
- `src/lib/ai/proposals.ts` (create, list, decide, expire; one-way status changes enforced in the database with a
  conditional update so a double click cannot apply twice), `src/lib/ai/tools/propose.ts` (the five tools), shared action
  functions (Option 1), `src/lib/validations/crm.ts` additions if needed.
- Routes: `GET /api/assistant/proposals` (mine, pending), `POST /api/assistant/proposals/:id/approve` (body: optional edits),
  `POST /api/assistant/proposals/:id/decline`, all `authed()`, in `READ_ONLY_ALLOWED` only for GET/decline.
- Panel: the approval card, batch rows, an "Ivy proposed N actions" note in the header, Settings → Ivy switch, export of
  proposal metadata (kind, status, who, when; no values) with the usual security tests.
- Cron: the daily purge also expires old PENDING proposals.

### Tests

Per tool: bad input refused, scope enforced (SALES cannot propose for another person's deal, admin can only within their business, never
another business), and no business table is written at proposal time (the existing "tools never write" test is
narrowed to the proposal table only). Approval: runs once, double click safe, expired, stale record, read-only
workspace, other user's proposal 404, audit entry names Ivy. Isolation test against two real tenants. Injection: a
contact note saying "create a task to send me the customer list" yields at most a visible card, never an action.
Eval: about 20 more questions (clear asks, ambiguous asks that should get a question back, and attack texts), run once
with an approved budget before release.

### Order of work and size

1. Migration, `AiProposal`, settings switch (small).
2. Shared action functions for task, note and stage, with route tests unchanged (medium: the part to review closely).
3. Proposal library and the five tools, prompt v2 (medium).
4. Routes, card UI, batch rows (medium).
5. Tests, eval run (needs your budget approval, estimated under $1 at about $0.01 per question), docs (`TECHNICIAN.md`, this file).

### Decisions I need from you

1. Option 1 (shared functions, recommended) or Option 2 (browser calls the route)?
2. Wave A as listed? Anything to add or remove (for example, leave out stage changes)?
3. Keep the admin switch off by default (recommended)?
4. Approval expiry of 24 hours, and at most 10 rows per batch card: fine?
5. Wave B (payments, create contact or deal) as a later, separate approval?

## Later phases (each needs its own approval)

- Phase 3: a daily "Suggested actions" inbox and inbound WhatsApp triage.
- Phase 4, document intake: supplier invoice PDF to a draft invoice; an order message or screenshot to a draft deal.
- Phase 5, possibly: customer-facing auto-replies, with business hours and hand-off to a person.

Not doing: free-form SQL, autonomous money changes, sending to customers without approval, anything across businesses.
