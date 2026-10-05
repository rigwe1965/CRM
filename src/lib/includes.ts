import type { Prisma } from "@prisma/client";

// Shared Prisma `include` shapes so list and detail responses look the same.
// (Kept out of route files: Next.js only allows HTTP method names as route exports.)

const person = { select: { id: true, name: true } } as const;

export const organizationInclude = {
  owner: person,
  _count: {
    select: {
      contacts: { where: { deletedAt: null } },
      deals: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.OrganizationInclude;

export const contactInclude = {
  organization: { select: { id: true, name: true } },
  owner: person,
  _count: {
    select: {
      deals: { where: { deletedAt: null } },
      activities: true,
      tasks: true,
    },
  },
} satisfies Prisma.ContactInclude;

export const dealInclude = {
  organization: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  owner: person,
} satisfies Prisma.DealInclude;

export const activityInclude = {
  author: person,
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.ActivityInclude;

export const taskInclude = {
  assignee: person,
  createdBy: person,
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
} satisfies Prisma.TaskInclude;
