import { Prisma } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth-helpers";
import { getIntegration } from "@/lib/integrations";
import { anthropicFor } from "@/lib/ai/client";
import { flagForeignContent } from "@/lib/ai/draft-check";
import { createBackgroundProposal } from "@/lib/ai/proposals";
import { loadAssistantSettings } from "@/lib/ai/settings";
import { ceilingState, monthToDateMicros } from "@/lib/ai/usage";
import { ToolError } from "@/lib/ai/tools/types";
import { findCandidates, MAX_SUGGESTIONS, type Candidate } from "@/lib/ai/inbox/rules";
import { writeWording, type Wording } from "@/lib/ai/inbox/wording";

/**
 * One person's daily "Suggested actions" (AI_ASSISTANT_PLAN.md, Phase 3b). Started the first time they use the app each
 * day. The CRM's rules pick the candidates (`findCandidates`), the model only writes words for them (`writeWording`), and
 * every card goes through the same `prepare` checks as a chat proposal. Runs once per person per day (`AiInboxRun`), works
 * only through that person's own scope, and when the model is unavailable or the ceiling is spent it still makes the
 * cards, with plain template wording. Run inside the business's context.
 */

export type InboxRunStatus = "disabled" | "muted" | "read_only" | "already" | "running" | "done" | "failed";

/** A run still marked RUNNING after this long is taken to have died, and may be started again. */
const STALE_RUN_MS = 10 * 60_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Whether the inbox is on for this person right now, and why not if it is not. Cheap: used by the status read as well. */
export async function inboxAvailability(user: SessionUser): Promise<"ok" | "disabled" | "muted" | "read_only"> {
  const settings = await loadAssistantSettings(user.tenantId);
  if (!settings.enabled || settings.inboxEnabled !== true) return "disabled";
  if (user.tenantWritable === false) return "read_only";
  const me = await db.user.findFirst({ where: { id: user.id, tenantId: user.tenantId }, select: { aiSuggestionsMuted: true } });
  return me?.aiSuggestionsMuted ? "muted" : "ok";
}

/** Has this person's run for the day been made (or is it running)? */
export async function runToday(user: { id: string; tenantId: string }, now = new Date()) {
  return db.aiInboxRun.findFirst({ where: { tenantId: user.tenantId, userId: user.id, day: day(now) }, select: { status: true, created: true, startedAt: true } });
}

/** Claims today's run. Returns false when it is already done, or running and not dead. */
async function claim(user: { id: string; tenantId: string }, now: Date): Promise<boolean> {
  const d = day(now);
  // Look first so the usual repeat does not log a failed insert; the catch covers a race.
  const exists = await db.aiInboxRun.findFirst({ where: { tenantId: user.tenantId, userId: user.id, day: d }, select: { id: true } });
  if (!exists) {
    try {
      await db.aiInboxRun.create({ data: { tenantId: user.tenantId, userId: user.id, day: d } });
      return true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  // It exists: only a failed run, or one that died, is started again.
  const taken = await db.aiInboxRun.updateMany({
    where: { tenantId: user.tenantId, userId: user.id, day: d, OR: [{ status: "FAILED" }, { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } }] },
    data: { status: "RUNNING", startedAt: now, finishedAt: null, error: null },
  });
  return taken.count === 1;
}

export async function runInboxForUser(user: SessionUser, opts: { now?: Date; client?: Pick<Anthropic, "beta"> | null } = {}): Promise<{ status: InboxRunStatus; created: number }> {
  const now = opts.now ?? new Date();
  const availability = await inboxAvailability(user);
  if (availability !== "ok") return { status: availability, created: 0 };

  if (!(await claim(user, now))) {
    const existing = await runToday(user, now);
    return { status: existing?.status === "DONE" ? "already" : "running", created: existing?.created ?? 0 };
  }

  try {
    const candidates = await findCandidates(user, now);
    let words = new Map<string, Wording>();
    let cost = 0;

    // The model is optional: no key, or the monthly ceiling spent, means plain template wording, not an empty inbox.
    const settings = await loadAssistantSettings(user.tenantId);
    const spent = await monthToDateMicros(user.tenantId, now);
    const level = ceilingState(settings.monthlyCeilingUsd, spent).level;
    const canSpend = level !== "reached" && level !== "unset";
    if (candidates.length > 0 && canSpend && opts.client !== null && (opts.client || (await getIntegration(user.tenantId, "ANTHROPIC")))) {
      const client = opts.client ?? (await anthropicFor(user.tenantId));
      const wrote = await writeWording({ client, tenantId: user.tenantId, userId: user.id, candidates, now });
      words = wrote.words;
      cost = wrote.costMicros;
    }

    let created = 0;
    for (const c of candidates) {
      if (created >= MAX_SUGGESTIONS) break;
      created += await makeCards(user, c, words.get(c.key), now, MAX_SUGGESTIONS - created);
    }
    await db.aiInboxRun.updateMany({
      where: { tenantId: user.tenantId, userId: user.id, day: day(now) },
      data: { status: "DONE", candidates: candidates.length, created, costMicros: cost, finishedAt: new Date() },
    });
    return { status: "done", created };
  } catch (e) {
    console.error("[ivy-inbox] run failed", e instanceof Error ? e.message : e);
    await db.aiInboxRun.updateMany({
      where: { tenantId: user.tenantId, userId: user.id, day: day(now) },
      data: { status: "FAILED", error: "The run could not finish.", finishedAt: new Date() },
    });
    return { status: "failed", created: 0 };
  }
}

/** The cards for one candidate: a task or a reschedule, and a draft message when there is a channel for one. Returns how many were made. */
async function makeCards(user: SessionUser, c: Candidate, wording: Wording | undefined, now: Date, room: number): Promise<number> {
  let made = 0;
  const base = { source: "DAILY" as const, reason: c.reason, subject: c.subject, now };
  const attempt = async (input: Parameters<typeof createBackgroundProposal>[1]) => {
    if (made >= room) return;
    try {
      if (await createBackgroundProposal(user, input)) made++;
    } catch (e) {
      // The record changed or is no longer visible since the rule ran: skip this card, keep the rest.
      if (!(e instanceof ToolError)) throw e;
    }
  };

  if (c.task) {
    await attempt({ ...base, kind: "TASK_CREATE", dedupeKey: `${c.key}:task`, raw: { ...c.task, title: wording?.taskTitle || c.task.title } });
  }
  if (c.taskChange) {
    await attempt({ ...base, kind: "TASK_CHANGE", dedupeKey: `${c.key}:chg`, raw: c.taskChange });
  }
  if (c.message) {
    const text = wording?.message || c.message.text;
    await attempt({
      ...base,
      kind: "MESSAGE_DRAFT",
      dedupeKey: `${c.key}:msg`,
      raw: { contactId: c.message.contactId, channel: c.message.channel, ...(c.message.subject ? { subject: c.message.subject } : {}), message: text },
      extraWarning: flagForeignContent(text, c.message.allowed) ?? undefined,
    });
  }
  return made;
}
