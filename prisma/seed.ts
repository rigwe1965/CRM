import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

async function main() {
  // Clear in FK-safe order so the seed is re-runnable.
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(
    process.env.SEED_USER_PASSWORD ?? "ChangeMe123!",
    10,
  );

  // ── Users ──
  const [admin, sales, support] = await Promise.all([
    prisma.user.create({
      data: { email: "admin@crm.test", name: "Alex Admin", role: "ADMIN", passwordHash },
    }),
    prisma.user.create({
      data: { email: "sales@crm.test", name: "Sam Sales", role: "SALES", passwordHash },
    }),
    prisma.user.create({
      data: { email: "support@crm.test", name: "Sue Support", role: "SUPPORT", passwordHash },
    }),
  ]);

  // ── Organizations ──
  const orgData = [
    { name: "Acme Corp", domain: "acme.com", industry: "Manufacturing", size: 1200, city: "Chicago", state: "IL", country: "US" },
    { name: "Globex Inc", domain: "globex.io", industry: "Software", size: 340, city: "Austin", state: "TX", country: "US" },
    { name: "Initech", domain: "initech.com", industry: "Consulting", size: 85, city: "Denver", state: "CO", country: "US" },
    { name: "Umbrella Health", domain: "umbrellahealth.org", industry: "Healthcare", size: 5000, city: "Boston", state: "MA", country: "US" },
    { name: "Stark Logistics", domain: "starklogistics.co", industry: "Logistics", size: 600, city: "Seattle", state: "WA", country: "US" },
  ];
  const orgs = [];
  for (const [i, o] of orgData.entries()) {
    orgs.push(
      await prisma.organization.create({
        data: { ...o, website: `https://${o.domain}`, ownerId: i % 2 === 0 ? sales.id : admin.id },
      }),
    );
  }

  // ── Contacts ──
  const contactData = [
    { firstName: "Wile", lastName: "Coyote", title: "Procurement Lead", type: "CUSTOMER", leadStatus: null, org: 0 },
    { firstName: "Road", lastName: "Runner", title: "VP Operations", type: "CUSTOMER", leadStatus: null, org: 0 },
    { firstName: "Hank", lastName: "Scorpio", title: "CEO", type: "PROSPECT", leadStatus: "QUALIFIED", org: 1 },
    { firstName: "Cathy", lastName: "Morris", title: "CTO", type: "LEAD", leadStatus: "CONTACTED", org: 1 },
    { firstName: "Bill", lastName: "Lumbergh", title: "Director", type: "CUSTOMER", leadStatus: null, org: 2 },
    { firstName: "Peter", lastName: "Gibbons", title: "Engineer", type: "LEAD", leadStatus: "NEW", org: 2 },
    { firstName: "Alice", lastName: "Wong", title: "Chief Medical Officer", type: "PROSPECT", leadStatus: "QUALIFIED", org: 3 },
    { firstName: "Victor", lastName: "Reyes", title: "IT Manager", type: "LEAD", leadStatus: "NEW", org: 3 },
    { firstName: "Pepper", lastName: "Potts", title: "COO", type: "CUSTOMER", leadStatus: null, org: 4 },
    { firstName: "Happy", lastName: "Hogan", title: "Fleet Manager", type: "LEAD", leadStatus: "UNQUALIFIED", org: 4 },
    { firstName: "Dana", lastName: "Scully", title: "Consultant", type: "PARTNER", leadStatus: null, org: null },
    { firstName: "Fox", lastName: "Mulder", title: "Freelancer", type: "LEAD", leadStatus: "CONTACTED", org: null },
  ] as const;
  const contacts = [];
  for (const [i, c] of contactData.entries()) {
    contacts.push(
      await prisma.contact.create({
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          email: `${c.firstName}.${c.lastName}@example.com`.toLowerCase(),
          phone: `+1-555-01${String(i).padStart(2, "0")}`,
          title: c.title,
          type: c.type,
          leadStatus: c.leadStatus,
          source: ["Website", "Referral", "Conference", "Cold outreach"][i % 4],
          organizationId: c.org === null ? null : orgs[c.org].id,
          ownerId: i % 3 === 0 ? admin.id : sales.id,
        },
      }),
    );
  }

  // ── Deals ──
  const dealData = [
    { title: "Acme – Annual Supply Renewal", amount: 120000, stage: "CLOSED_WON", prob: 100, org: 0, contact: 0, close: -20 },
    { title: "Globex – Platform License", amount: 85000, stage: "NEGOTIATION", prob: 75, org: 1, contact: 2, close: 14 },
    { title: "Globex – Pilot Program", amount: 15000, stage: "DISCOVERY", prob: 30, org: 1, contact: 3, close: 45 },
    { title: "Initech – Process Audit", amount: 22000, stage: "PROPOSAL", prob: 55, org: 2, contact: 4, close: 21 },
    { title: "Umbrella – Clinic Rollout", amount: 340000, stage: "QUALIFICATION", prob: 15, org: 3, contact: 6, close: 90 },
    { title: "Umbrella – IT Support Plan", amount: 48000, stage: "PROPOSAL", prob: 50, org: 3, contact: 7, close: 30 },
    { title: "Stark – Fleet Tracking", amount: 67000, stage: "CLOSED_LOST", prob: 0, org: 4, contact: 9, close: -10 },
    { title: "Stark – Warehouse Automation", amount: 210000, stage: "DISCOVERY", prob: 25, org: 4, contact: 8, close: 60 },
  ] as const;
  const deals = [];
  for (const [i, d] of dealData.entries()) {
    const closed = d.stage === "CLOSED_WON" || d.stage === "CLOSED_LOST";
    deals.push(
      await prisma.deal.create({
        data: {
          title: d.title,
          amount: d.amount,
          stage: d.stage,
          probability: d.prob,
          expectedCloseDate: daysFromNow(d.close),
          closedAt: closed ? daysFromNow(d.close) : null,
          lostReason: d.stage === "CLOSED_LOST" ? "Chose a competitor on price" : null,
          organizationId: orgs[d.org].id,
          contactId: contacts[d.contact].id,
          ownerId: i % 2 === 0 ? sales.id : admin.id,
        },
      }),
    );
  }

  // ── Activities ──
  await prisma.activity.createMany({
    data: [
      { type: "CALL", subject: "Intro call with Hank", body: "Discussed licensing tiers.", authorId: sales.id, contactId: contacts[2].id, dealId: deals[1].id, occurredAt: daysFromNow(-5) },
      { type: "EMAIL", subject: "Sent proposal to Initech", authorId: sales.id, contactId: contacts[4].id, dealId: deals[3].id, occurredAt: daysFromNow(-3) },
      { type: "MEETING", subject: "Discovery workshop", body: "Mapped warehouse workflows.", authorId: admin.id, dealId: deals[7].id, occurredAt: daysFromNow(-7) },
      { type: "NOTE", subject: "Budget confirmed", body: "Finance approved up to $90k.", authorId: sales.id, dealId: deals[1].id, occurredAt: daysFromNow(-2) },
      { type: "CALL", subject: "Follow-up with Cathy", authorId: sales.id, contactId: contacts[3].id, occurredAt: daysFromNow(-1) },
      { type: "EMAIL", subject: "Support plan SLA questions", authorId: support.id, contactId: contacts[7].id, dealId: deals[5].id, occurredAt: daysFromNow(-4) },
      { type: "NOTE", subject: "Lost to competitor", body: "Price was the deciding factor.", authorId: admin.id, dealId: deals[6].id, occurredAt: daysFromNow(-10) },
      { type: "MEETING", subject: "Renewal kickoff", authorId: sales.id, organizationId: orgs[0].id, dealId: deals[0].id, occurredAt: daysFromNow(-30) },
      { type: "NOTE", subject: "Partner referral", body: "Dana referred two prospects.", authorId: admin.id, contactId: contacts[10].id, occurredAt: daysFromNow(-6) },
      { type: "CALL", subject: "Onboarding check-in", authorId: support.id, contactId: contacts[8].id, occurredAt: daysFromNow(-8) },
    ],
  });

  // ── Tasks ──
  await prisma.task.createMany({
    data: [
      { title: "Send revised quote to Globex", status: "TODO", priority: "HIGH", dueDate: daysFromNow(2), assigneeId: sales.id, createdById: admin.id, dealId: deals[1].id, contactId: contacts[2].id },
      { title: "Schedule demo for Initech", status: "IN_PROGRESS", priority: "MEDIUM", dueDate: daysFromNow(5), assigneeId: sales.id, createdById: sales.id, dealId: deals[3].id },
      { title: "Qualify Victor Reyes", status: "TODO", priority: "LOW", dueDate: daysFromNow(7), assigneeId: sales.id, createdById: admin.id, contactId: contacts[7].id },
      { title: "Prepare Umbrella clinic proposal", status: "TODO", priority: "URGENT", dueDate: daysFromNow(3), assigneeId: admin.id, createdById: admin.id, dealId: deals[4].id },
      { title: "Resolve SLA question for Umbrella", status: "IN_PROGRESS", priority: "HIGH", dueDate: daysFromNow(1), assigneeId: support.id, createdById: sales.id, dealId: deals[5].id },
      { title: "Send renewal thank-you", status: "DONE", priority: "LOW", dueDate: daysFromNow(-15), completedAt: daysFromNow(-16), assigneeId: sales.id, createdById: sales.id, dealId: deals[0].id },
      { title: "Post-mortem on Stark loss", status: "DONE", priority: "MEDIUM", dueDate: daysFromNow(-5), completedAt: daysFromNow(-6), assigneeId: admin.id, createdById: admin.id, dealId: deals[6].id },
      { title: "Follow up with Fox Mulder", status: "CANCELLED", priority: "LOW", assigneeId: sales.id, createdById: sales.id, contactId: contacts[11].id },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    organizations: await prisma.organization.count(),
    contacts: await prisma.contact.count(),
    deals: await prisma.deal.count(),
    activities: await prisma.activity.count(),
    tasks: await prisma.task.count(),
  };
  console.log("Seeded:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
