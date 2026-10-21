import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadQuietLeads } from "@/lib/automations/settings";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Most tasks one run will create, so switching the rule on can't bury the team in a single day. */
export const QUIET_LEAD_LIMIT = 500;

const OPEN = ["TODO", "IN_PROGRESS"] as const;

/**
 * Leads and prospects that nobody has touched for `days`: nothing logged on the contact or on any of its
 * deals, no task completed for it, and no nudge already open or made within that window. Unqualified
 * leads, deleted contacts, contacts younger than the window and contacts without an active owner are left out.
 */
export function quietLeadWhere(days: number, now: Date): Prisma.ContactWhereInput {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return {
    deletedAt: null,
    type: { in: ["LEAD", "PROSPECT"] },
    ownerId: { not: null },
    owner: { isActive: true },
    createdAt: { lt: cutoff },
    AND: [
      { OR: [{ leadStatus: null }, { leadStatus: { not: "UNQUALIFIED" } }] },
      { activities: { none: { occurredAt: { gte: cutoff } } } },
      { deals: { none: { deletedAt: null, activities: { some: { occurredAt: { gte: cutoff } } } } } },
      { tasks: { none: { completedAt: { gte: cutoff } } } },
      {
        tasks: {
          none: {
            automationKey: { startsWith: "quiet:" },
            OR: [{ status: { in: [...OPEN] } }, { createdAt: { gte: cutoff } }],
          },
        },
      },
    ],
  };
}

/** How many contacts would get a task right now (shown in Settings before an admin switches the rule on). */
export const countQuietLeads = (days: number, now = new Date()) => db.contact.count({ where: quietLeadWhere(days, now) });

/** Creates one follow-up task per quiet lead, assigned to its owner and due tomorrow. */
export async function runQuietLeadNudges(now = new Date()) {
  const config = await loadQuietLeads();
  if (!config.enabled) return { created: 0 };

  const leads = await db.contact.findMany({
    where: quietLeadWhere(config.days, now),
    select: { id: true, firstName: true, lastName: true, ownerId: true },
    orderBy: { createdAt: "asc" },
    take: QUIET_LEAD_LIMIT,
  });
  if (leads.length === 0) return { created: 0 };

  const due = new Date(now.getTime() + DAY_MS);
  const { count } = await db.task.createMany({
    data: leads.map((c) => ({
      title: `Follow up with ${c.firstName} ${c.lastName}: no contact in ${config.days} days`.slice(0, 200),
      description: "Created automatically: nothing has been logged for this lead recently. Log a call, message or email, or mark the lead unqualified.",
      priority: "MEDIUM" as const,
      dueDate: due,
      assigneeId: c.ownerId!,
      createdById: c.ownerId!,
      contactId: c.id,
      automationKey: `quiet:${c.id}`,
    })),
  });
  await audit({ email: "automation" }, { action: "automation.quiet_leads", entity: "contact", summary: `${count} follow-up task${count === 1 ? "" : "s"} created` });
  return { created: count };
}
