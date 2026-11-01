import type { ContactType } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth-helpers";
import { tenantScope } from "@/lib/access";
import { contactHeadroom } from "@/lib/plan-limits";
import { normalizePhone } from "@/lib/phone";
import { importContactRow } from "@/lib/validations/crm";

export type ImportSkip = { row: number; name: string; reason: string };
export type ImportOutcome = { created: number; skippedCount: number; skipped: ImportSkip[] };

const MAX_SKIPS_SHOWN = 100;

/**
 * Adds a customer list to the caller's business. Each row is checked on its own: a row with no valid name or a bad
 * email, an email or phone number that already belongs to a contact (deleted ones included, since email is unique), a
 * repeat inside the file, or a row past the plan's contact limit is skipped with a reason and the rest still go in.
 * Nobody is signed up to anything: email and WhatsApp consent stay off, because a spreadsheet is not consent.
 * The caller owns what they import. Rows are numbered from 1, in the order sent.
 */
export async function importContacts(user: SessionUser, input: { type: ContactType; rows: unknown[] }): Promise<ImportOutcome> {
  const skipped: ImportSkip[] = [];
  let skippedCount = 0;
  const skip = (row: number, name: string, reason: string) => {
    skippedCount++;
    if (skipped.length < MAX_SKIPS_SHOWN) skipped.push({ row, name, reason });
  };

  const valid: { row: number; data: { firstName: string; lastName: string; email: string | null; phone: string | null; phoneE164: string | null; city: string | null; state: string | null; country: string | null } }[] = [];
  input.rows.forEach((raw, i) => {
    const row = i + 1;
    const parsed = importContactRow.safeParse(raw);
    if (!parsed.success) {
      const name = typeof (raw as { firstName?: unknown })?.firstName === "string" ? String((raw as { firstName: string }).firstName).slice(0, 60) : "";
      return skip(row, name, parsed.error.issues[0]?.path[0] === "email" ? "The email address is not valid" : "A first and last name are needed");
    }
    const d = parsed.data;
    valid.push({ row, data: { firstName: d.firstName, lastName: d.lastName, email: d.email ?? null, phone: d.phone ?? null, phoneE164: normalizePhone(d.phone), city: d.city ?? null, state: d.state ?? null, country: d.country ?? null } });
  });

  // What the business already has. Email is unique per business and the index counts deleted contacts too.
  const emails = valid.flatMap((v) => (v.data.email ? [v.data.email] : []));
  const phones = valid.flatMap((v) => (v.data.phoneE164 ? [v.data.phoneE164] : []));
  // A row with neither email nor phone can only be recognised by name, so a second import of the same list does not double it.
  const nameKey = (first: string, last: string) => `${first}|${last}`.toLowerCase();
  const bare = valid.filter((v) => !v.data.email && !v.data.phoneE164);
  const [byEmail, byPhone, byName, headroom] = await Promise.all([
    emails.length ? db.contact.findMany({ where: { ...tenantScope(user), email: { in: emails } }, select: { email: true } }) : [],
    phones.length ? db.contact.findMany({ where: { ...tenantScope(user), deletedAt: null, phoneE164: { in: phones } }, select: { phoneE164: true } }) : [],
    bare.length
      ? db.contact.findMany({
          where: { ...tenantScope(user), deletedAt: null, OR: bare.map((v) => ({ firstName: { equals: v.data.firstName, mode: "insensitive" as const }, lastName: { equals: v.data.lastName, mode: "insensitive" as const } })) },
          select: { firstName: true, lastName: true },
        })
      : [],
    contactHeadroom(user.tenantId),
  ]);
  const knownNames = new Set(byName.map((c) => nameKey(c.firstName, c.lastName)));
  const seenNames = new Set<string>();
  const knownEmails = new Set(byEmail.map((c) => c.email));
  const knownPhones = new Set(byPhone.map((c) => c.phoneE164));

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const toCreate: typeof valid = [];
  for (const v of valid) {
    const name = `${v.data.firstName} ${v.data.lastName === "-" ? "" : v.data.lastName}`.trim();
    const { email, phoneE164 } = v.data;
    if (email && (knownEmails.has(email) || seenEmails.has(email))) skip(v.row, name, knownEmails.has(email) ? "This email already belongs to a contact" : "Repeated in the file");
    else if (phoneE164 && (knownPhones.has(phoneE164) || seenPhones.has(phoneE164))) skip(v.row, name, knownPhones.has(phoneE164) ? "This phone number already belongs to a contact" : "Repeated in the file");
    else if (!email && !phoneE164 && (knownNames.has(nameKey(v.data.firstName, v.data.lastName)) || seenNames.has(nameKey(v.data.firstName, v.data.lastName)))) {
      skip(v.row, name, knownNames.has(nameKey(v.data.firstName, v.data.lastName)) ? "A contact with this name already exists (no email or phone to tell them apart)" : "Repeated in the file");
    } else if (toCreate.length >= headroom) skip(v.row, name, "Your plan's contact limit is reached");
    else {
      if (email) seenEmails.add(email);
      if (phoneE164) seenPhones.add(phoneE164);
      if (!email && !phoneE164) seenNames.add(nameKey(v.data.firstName, v.data.lastName));
      toCreate.push(v);
    }
  }

  let created = 0;
  if (toCreate.length) {
    const result = await db.contact.createMany({
      data: toCreate.map((v) => ({ ...v.data, ...tenantScope(user), type: input.type, ...(input.type === "LEAD" && { leadStatus: "NEW" as const }), source: "Import", ownerId: user.id })),
      skipDuplicates: true, // someone else added the same email a moment ago: that row is simply not added
    });
    created = result.count;
    if (created < toCreate.length) skippedCount += toCreate.length - created;
  }
  return { created, skippedCount, skipped };
}
