// Shapes returned by the REST API (dates arrive as ISO strings). Kept free of @prisma/client
// so client bundles never import the Prisma package.

export type Role = "ADMIN" | "SALES" | "SUPPORT";
export type ContactType = "LEAD" | "PROSPECT" | "CUSTOMER" | "PARTNER" | "OTHER";
export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED";
export type DealStage =
  | "QUALIFICATION"
  | "DISCOVERY"
  | "PROPOSAL"
  | "NEGOTIATION"
  | "CLOSED_WON"
  | "CLOSED_LOST";
export type ActivityType = "NOTE" | "CALL" | "EMAIL" | "MEETING";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type Person = { id: string; name: string };
export type ContactRef = { id: string; firstName: string; lastName: string };

export type Organization = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: number | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: Person | null;
  _count: { contacts: number; deals: number };
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  type: ContactType;
  leadStatus: LeadStatus | null;
  source: string | null;
  organizationId: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  organization: { id: string; name: string } | null;
  owner: Person | null;
  _count: { deals: number; activities: number; tasks: number };
};

export type Deal = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  stage: DealStage;
  probability: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  organizationId: string | null;
  contactId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  organization: { id: string; name: string } | null;
  contact: ContactRef | null;
  owner: Person;
};

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurredAt: string;
  authorId: string;
  contactId: string | null;
  dealId: string | null;
  organizationId: string | null;
  author: Person;
  contact: ContactRef | null;
  deal: { id: string; title: string } | null;
  organization: { id: string; name: string } | null;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  assigneeId: string;
  createdById: string;
  contactId: string | null;
  dealId: string | null;
  assignee: Person;
  createdBy: Person;
  contact: ContactRef | null;
  deal: { id: string; title: string } | null;
};

export type TeamUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

export type Paginated<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

export type PipelineStage = { stage: DealStage; count: number; amount: number; weightedAmount: number };

export type Dashboard = {
  counts: {
    contacts: number;
    contactsByType: Partial<Record<ContactType, number>>;
    organizations: number;
    openDeals: number;
    openTasks: number;
    overdueTasks: number;
  };
  pipeline: {
    stages: PipelineStage[];
    openCount: number;
    openAmount: number;
    openWeightedAmount: number;
  };
  revenue: {
    wonTotal: number;
    wonDealsTotal: number;
    wonLast30Days: number;
    wonDealsLast30Days: number;
    winRate: number | null;
  };
  recentActivities: Activity[];
  upcomingTasks: Task[];
};

export type SessionUser = { id: string; name: string; email: string; role: Role };
