import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { appUrl, trySendMail } from "@/lib/mail";
import { normalizePhone } from "@/lib/phone";
import type { z } from "zod";
import type { webLeadSchema } from "@/lib/validations/crm";

const KEY = "lead-form";

/** Who new website leads go to: the admin's choice if that person is still active, else the oldest active admin. */
export async function resolveLeadOwner(tenantId: string) {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  const chosen = (row?.config as { ownerId?: string | null } | null)?.ownerId;
  if (chosen) {
    const u = await db.user.findFirst({ where: { tenantId, id: chosen, isActive: true }, select: { id: true, name: true, email: true } });
    if (u) return u;
  }
  return db.user.findFirst({ where: { tenantId, role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true } });
}

export async function loadLeadFormOwnerId(tenantId: string): Promise<string | null> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  return (row?.config as { ownerId?: string | null } | null)?.ownerId ?? null;
}

export async function saveLeadFormOwnerId(tenantId: string, ownerId: string | null, updatedById: string) {
  const config = { ownerId };
  await db.automationSetting.upsert({ where: { tenantId_key: { tenantId, key: KEY } }, create: { tenantId, key: KEY, config, updatedById }, update: { config, updatedById } });
}

/** Websites allowed to post the form from a visitor's browser: LEAD_FORM_ORIGINS, comma separated (https://shop.example.com). */
export const allowedOrigins = () =>
  (process.env.LEAD_FORM_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const UNVERIFIED = "[Unverified website form submission]";
const PREVIEW_CHARS = 100;

/**
 * Turns a form submission into a lead. Quietly does nothing visible to the sender in every case (the caller
 * answers "thanks" regardless), so the form can't be used to find out who is already a contact.
 *  - New person: a LEAD with source "Website", the message as a note, and a "reply" task due today for the owner.
 *  - Email already a contact: no second contact; the message is added to them as a note and the owner is told.
 */
export async function captureWebLead(tenantId: string, input: z.infer<typeof webLeadSchema>) {
  const owner = await resolveLeadOwner(tenantId);
  if (!owner) throw new Error("No active admin to receive web leads");
  const name = oneLine(input.name);
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ") || "-";
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  const message = input.message?.trim() || null;

  const existing = email ? await db.contact.findFirst({ where: { tenantId, email: { equals: email, mode: "insensitive" }, deletedAt: null }, select: { id: true, ownerId: true, firstName: true, lastName: true } }) : null;
  const authorId = existing?.ownerId ?? owner.id;
  const contactId =
    existing?.id ??
    (
      await db.contact.create({
        data: { tenantId, firstName, lastName, email, phone, phoneE164: normalizePhone(phone), type: "LEAD", leadStatus: "NEW", source: "Website", ownerId: owner.id },
        select: { id: true },
      })
    ).id;

  await db.activity.create({
    data: {
      tenantId,
      type: "NOTE",
      subject: existing ? "Sent the website form again" : "Website enquiry",
      // Anyone can type a known email into the public form, so text added to an existing contact is marked unverified.
      body: existing ? `${UNVERIFIED}\n${message ?? "Submitted the website form without a message."}` : (message ?? "Submitted the website form without a message."),
      authorId,
      contactId,
    },
  });
  if (!existing) {
    await db.task.create({
      data: {
        tenantId,
        title: `Reply to website enquiry from ${name}`,
        priority: "HIGH",
        dueDate: new Date(),
        assigneeId: owner.id,
        createdById: owner.id,
        contactId,
        automationKey: `weblead:${contactId}`,
      },
    });
  }
  await audit({ email: "website-form", tenantId }, { action: existing ? "lead.web_repeat" : "lead.web_created", entity: "contact", entityId: contactId, summary: name });

  // Tell the owner. A failed email must not lose the lead, which is already saved.
  const to = existing?.ownerId ? (await db.user.findFirst({ where: { tenantId, id: existing.ownerId, isActive: true }, select: { email: true } }))?.email ?? owner.email : owner.email;
  const open = `Open: ${appUrl()}/contacts/${contactId}`;
  if (existing) {
    // Typed details are not trusted: the email names the stored contact and shows only a short, marked preview.
    const known = `${existing.firstName} ${existing.lastName === "-" ? "" : existing.lastName}`.trim();
    const preview = message ? oneLine(message).slice(0, PREVIEW_CHARS) : null;
    await trySendMail({
      to,
      subject: `Website form again: ${oneLine(known)}`.slice(0, 150),
      text: [
        `Someone used the website form with ${known}'s email address. We can't confirm it was them.`,
        preview && `\nPreview (unverified, first ${PREVIEW_CHARS} characters):\n${preview}${message && oneLine(message).length > PREVIEW_CHARS ? "…" : ""}`,
        `\n${open}`,
      ].filter(Boolean).join("\n"),
    });
    return { contactId, created: false };
  }
  await trySendMail({
    to,
    subject: `New website lead: ${name}`.slice(0, 150),
    text: [`${name}`, email && `Email: ${email}`, phone && `Phone: ${phone}`, message && `\n${message}`, `\n${open}`].filter(Boolean).join("\n"),
  });
  return { contactId, created: !existing };
}
