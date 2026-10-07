import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sampleInvoice } from "./sample-invoice";

// The seed WIPES every table. Refuse unless the database is local (or --force is passed on purpose).
function assertSafeTarget() {
  if (process.argv.includes("--force")) return;
  const url = process.env.DATABASE_URL ?? "";
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"].includes(host);
  if (process.env.NODE_ENV === "production" || !local) {
    console.error(`Refusing to seed: DATABASE_URL host "${host || "unknown"}" is not local (or NODE_ENV=production).`);
    console.error("The seed deletes all data. Pass --force only if you are sure.");
    process.exit(1);
  }
}
assertSafeTarget();

const prisma = new PrismaClient();

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

async function main() {
  // Clear in FK-safe order so the seed is re-runnable.
  await prisma.invoice.deleteMany();
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
    { name: "Crown Beauty Supply", domain: "crownbeautysupply.com", industry: "Beauty supply", size: 12, city: "Atlanta", state: "GA", country: "US" },
    { name: "Luxe Lace Salon", domain: "luxelacesalon.com", industry: "Salon", size: 8, city: "Houston", state: "TX", country: "US" },
    { name: "Glam Studio Boutique", domain: "glamstudioboutique.com", industry: "Boutique", size: 4, city: "Los Angeles", state: "CA", country: "US" },
    { name: "Royal Tresses Beauty", domain: "royaltresses.ng", industry: "Wholesale", size: 25, city: "Lagos", state: null, country: "NG" },
    { name: "Velvet Strands Collective", domain: "velvetstrands.co", industry: "Wig reseller", size: 6, city: "Miami", state: "FL", country: "US" },
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
    { firstName: "Tasha", lastName: "Brown", title: "Buyer", type: "CUSTOMER", leadStatus: null, org: 0 },
    { firstName: "Marcus", lastName: "Reed", title: "Store Manager", type: "CUSTOMER", leadStatus: null, org: 0 },
    { firstName: "Imani", lastName: "Carter", title: "Salon Owner", type: "PROSPECT", leadStatus: "QUALIFIED", org: 1 },
    { firstName: "Jasmine", lastName: "Lee", title: "Lead Stylist", type: "LEAD", leadStatus: "CONTACTED", org: 1 },
    { firstName: "Keisha", lastName: "Johnson", title: "Boutique Owner", type: "CUSTOMER", leadStatus: null, org: 2 },
    { firstName: "Brianna", lastName: "Cole", title: "Stylist", type: "LEAD", leadStatus: "NEW", org: 2 },
    { firstName: "Adaeze", lastName: "Okafor", title: "Director", type: "PROSPECT", leadStatus: "QUALIFIED", org: 3 },
    { firstName: "Chioma", lastName: "Eze", title: "Purchasing Manager", type: "LEAD", leadStatus: "NEW", org: 3 },
    { firstName: "Nia", lastName: "Thompson", title: "Founder", type: "CUSTOMER", leadStatus: null, org: 4 },
    { firstName: "Camille", lastName: "Dupont", title: "Buyer", type: "LEAD", leadStatus: "UNQUALIFIED", org: 4 },
    { firstName: "Simone", lastName: "Harris", title: "Hair Influencer", type: "PARTNER", leadStatus: null, org: null },
    { firstName: "Dominique", lastName: "Ward", title: "Freelance Stylist", type: "LEAD", leadStatus: "CONTACTED", org: null },
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
          source: ["Instagram", "Referral", "Website", "WhatsApp"][i % 4],
          organizationId: c.org === null ? null : orgs[c.org].id,
          ownerId: i % 3 === 0 ? admin.id : sales.id,
        },
      }),
    );
  }

  // ── Deals ──
  const dealData = [
    { title: "Crown Beauty – Wholesale Bundle Restock", amount: 4800, stage: "CLOSED_WON", prob: 100, org: 0, contact: 0, close: -20, productType: "Bundles", texture: "Body wave", lengthInches: "18, 20, 22, 24", color: "Natural black", laceType: null, quantity: 40 },
    { title: "Luxe Lace – Salon Starter Pack", amount: 3200, stage: "NEGOTIATION", prob: 75, org: 1, contact: 2, close: 14, productType: "Lace wig", texture: "Deep wave", lengthInches: "20, 22", color: "Natural black", laceType: "HD lace", quantity: 8 },
    { title: "Luxe Lace – Sample Order", amount: 650, stage: "DISCOVERY", prob: 30, org: 1, contact: 3, close: 45, productType: "Bundles", texture: "Straight", lengthInches: "16, 18, 20", color: "1B", laceType: null, quantity: 3 },
    { title: "Glam Studio – HD Lace Frontal Order", amount: 1800, stage: "PROPOSAL", prob: 55, org: 2, contact: 4, close: 21, productType: "Frontal", texture: "Water wave", lengthInches: "18, 20", color: "Natural black", laceType: "13x4 frontal", quantity: 12 },
    { title: "Royal Tresses – Bulk Container Order", amount: 12500, stage: "QUALIFICATION", prob: 15, org: 3, contact: 6, close: 90, productType: "Bundles", texture: "Straight", lengthInches: "14–30", color: "Natural black", laceType: null, quantity: 150 },
    { title: "Royal Tresses – Closure Restock", amount: 2100, stage: "PROPOSAL", prob: 50, org: 3, contact: 7, close: 30, productType: "Closure", texture: "Loose wave", lengthInches: "16, 18", color: "Natural black", laceType: "5x5 closure", quantity: 30 },
    { title: "Velvet Strands – Wig Reseller Program", amount: 5400, stage: "CLOSED_LOST", prob: 0, org: 4, contact: 9, close: -10, productType: "Lace wig", texture: "Curly", lengthInches: "18, 22", color: "Honey blonde", laceType: "Transparent lace", quantity: 20 },
    { title: "Velvet Strands – Custom Wig Batch", amount: 3900, stage: "DISCOVERY", prob: 25, org: 4, contact: 8, close: 60, productType: "Custom wig", texture: "Kinky curly", lengthInches: "16, 20", color: "613", laceType: "HD lace", quantity: 10 },
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
          lostReason: d.stage === "CLOSED_LOST" ? "Went with a cheaper supplier" : null,
          productType: d.productType,
          texture: d.texture,
          lengthInches: d.lengthInches,
          color: d.color,
          laceType: d.laceType,
          quantity: d.quantity,
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
      { type: "CALL", subject: "Intro call with Imani", body: "Discussed wholesale pricing for salon wigs.", authorId: sales.id, contactId: contacts[2].id, dealId: deals[1].id, occurredAt: daysFromNow(-5) },
      { type: "EMAIL", subject: "Sent price list to Glam Studio", authorId: sales.id, contactId: contacts[4].id, dealId: deals[3].id, occurredAt: daysFromNow(-3) },
      { type: "MEETING", subject: "Video call: custom wig specs", body: "Confirmed 613 color and HD lace on 10 units.", authorId: admin.id, dealId: deals[7].id, occurredAt: daysFromNow(-7) },
      { type: "NOTE", subject: "Deposit received", body: "50% deposit paid via bank transfer.", authorId: sales.id, dealId: deals[1].id, occurredAt: daysFromNow(-2) },
      { type: "CALL", subject: "Follow-up with Jasmine", authorId: sales.id, contactId: contacts[3].id, occurredAt: daysFromNow(-1) },
      { type: "EMAIL", subject: "Shipping and customs questions", authorId: support.id, contactId: contacts[7].id, dealId: deals[5].id, occurredAt: daysFromNow(-4) },
      { type: "NOTE", subject: "Lost to competitor", body: "Price was the deciding factor.", authorId: admin.id, dealId: deals[6].id, occurredAt: daysFromNow(-10) },
      { type: "MEETING", subject: "Restock planning", authorId: sales.id, organizationId: orgs[0].id, dealId: deals[0].id, occurredAt: daysFromNow(-30) },
      { type: "NOTE", subject: "Influencer referral", body: "Simone referred two salon owners.", authorId: admin.id, contactId: contacts[10].id, occurredAt: daysFromNow(-6) },
      { type: "CALL", subject: "Delivery check-in", authorId: support.id, contactId: contacts[8].id, occurredAt: daysFromNow(-8) },
    ],
  });

  // ── Tasks ──
  await prisma.task.createMany({
    data: [
      { title: "Send revised quote to Luxe Lace", status: "TODO", priority: "HIGH", dueDate: daysFromNow(2), assigneeId: sales.id, createdById: admin.id, dealId: deals[1].id, contactId: contacts[2].id },
      { title: "Ship sample bundles to Luxe Lace", status: "IN_PROGRESS", priority: "MEDIUM", dueDate: daysFromNow(5), assigneeId: sales.id, createdById: sales.id, dealId: deals[2].id },
      { title: "Qualify Chioma Eze", status: "TODO", priority: "LOW", dueDate: daysFromNow(7), assigneeId: sales.id, createdById: admin.id, contactId: contacts[7].id },
      { title: "Prepare Royal Tresses container quote", status: "TODO", priority: "URGENT", dueDate: daysFromNow(3), assigneeId: admin.id, createdById: admin.id, dealId: deals[4].id },
      { title: "Answer customs questions for Royal Tresses", status: "IN_PROGRESS", priority: "HIGH", dueDate: daysFromNow(1), assigneeId: support.id, createdById: sales.id, dealId: deals[5].id },
      { title: "Send restock thank-you to Crown Beauty", status: "DONE", priority: "LOW", dueDate: daysFromNow(-15), completedAt: daysFromNow(-16), assigneeId: sales.id, createdById: sales.id, dealId: deals[0].id },
      { title: "Review why Velvet Strands went elsewhere", status: "DONE", priority: "MEDIUM", dueDate: daysFromNow(-5), completedAt: daysFromNow(-6), assigneeId: admin.id, createdById: admin.id, dealId: deals[6].id },
      { title: "Follow up with Dominique Ward", status: "CANCELLED", priority: "LOW", assigneeId: sales.id, createdById: sales.id, contactId: contacts[11].id },
    ],
  });

  // ── Invoices ──
  const { rows, ...invoice } = sampleInvoice;
  await prisma.invoice.create({
    data: {
      ...invoice,
      status: "SENT",
      ownerId: sales.id,
      items: {
        create: rows.map(([ref, style, description, color, density, lengthInches, quantity, unitPrice, lineTotal, resalePrice, note], i) => ({
          position: i + 1,
          ref,
          style,
          description,
          color,
          density,
          lengthInches,
          quantity,
          unitPrice,
          lineTotal,
          resalePrice,
          note,
        })),
      },
    },
  });

  const counts = {
    users: await prisma.user.count(),
    organizations: await prisma.organization.count(),
    contacts: await prisma.contact.count(),
    deals: await prisma.deal.count(),
    activities: await prisma.activity.count(),
    tasks: await prisma.task.count(),
    invoices: await prisma.invoice.count(),
  };
  console.log("Seeded:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
