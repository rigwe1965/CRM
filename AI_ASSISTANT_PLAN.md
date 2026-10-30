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

## Phase 1: Ask Ivy (read-only) — not started, needs its own approval

A streaming loop (hand-written, so every iteration is metered), about ten read-only tools wrapping existing scoped
code (contacts, deals and payments, overdue instalments, stock, cash flow, reports, Money checks, tasks), a side panel
opened from the header or Ctrl/Cmd+K, injection and tenant-isolation tests, and a ~40-question eval script that runs
against a real key (each run spends money, so it needs approval and a budget first).

## Later phases (each needs its own approval)

- Phase 2, proposals: approval cards for creating tasks and notes, drafting follow-ups, changing stage, recording a payment.
- Phase 3: a daily "Suggested actions" inbox and inbound WhatsApp triage.
- Phase 4, document intake: supplier invoice PDF to a draft invoice; an order message or screenshot to a draft deal.
- Phase 5, possibly: customer-facing auto-replies, with business hours and hand-off to a person.

Not doing: free-form SQL, autonomous money changes, sending to customers without approval, anything across businesses.
