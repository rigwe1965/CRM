import type { DealStage } from "@prisma/client";
import { appUrl } from "@/lib/mail";

// Plain template functions: every interpolated value goes through esc() (HTML) or is a URL we built.

type Rendered = { subject: string; text: string; html: string };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** User-typed text for an email subject: any run of whitespace or control characters becomes one space. */
export const oneLine = (s: string) => s.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();

/** Plain text (user-typed) → HTML paragraphs with line breaks. */
export const textToHtml = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

function layout(title: string, bodyHtml: string, footer = "Sent by your CRM.") {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:8px;padding:28px">
<tr><td style="font-size:18px;font-weight:600;padding-bottom:16px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="font-size:12px;color:#71717a;padding-top:20px;border-top:1px solid #e4e4e7">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (url: string, label: string) =>
  `<p style="margin:20px 0"><a href="${url}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${esc(label)}</a></p>`;

export function welcomeEmail(name: string): Rendered {
  const url = `${appUrl()}/dashboard`;
  return {
    subject: "Welcome to CRM",
    text: `Hi ${name},\n\nYour account is ready. Open your dashboard to add your first contacts and deals:\n${url}\n`,
    html: layout(
      `Welcome, ${name}`,
      `<p style="margin:0 0 14px">Your account is ready. Add your first contacts and deals from the dashboard.</p>${button(url, "Open dashboard")}`,
    ),
  };
}

export function verifySignupEmail(name: string, businessName: string, url: string): Rendered {
  return {
    subject: "Confirm your email to start your CRM",
    text: `Hi ${name},

Confirm your email to open ${businessName}'s CRM:
${url}

The link expires in 24 hours. If you didn't sign up, ignore this email and nothing will be created.`,
    html: layout(
      `Welcome, ${name}`,
      `<p style="margin:0">Confirm your email to open the CRM for <strong>${esc(businessName)}</strong>. The link expires in 24 hours.</p>${button(url, "Confirm my email")}<p style="margin:0;color:#71717a">If you didn't sign up, you can ignore this email.</p>`,
    ),
  };
}

export function signupExistsEmail(): Rendered {
  return {
    subject: "You already have a CRM account",
    text: `Someone tried to sign up with this email address, but it already has an account. If it was you, sign in or reset your password:
${appUrl()}/sign-in

If it wasn't you, you can ignore this email.`,
    html: layout(
      "You already have an account",
      `<p style="margin:0">Someone tried to sign up with this email address, but it already has an account. If it was you, sign in or reset your password.</p>${button(`${appUrl()}/sign-in`, "Sign in")}<p style="margin:0;color:#71717a">If it wasn't you, you can ignore this email.</p>`,
    ),
  };
}

export function deletionScheduledEmail(business: string, erasedOn: Date): Rendered {
  const date = erasedOn.toISOString().slice(0, 10);
  return {
    subject: `${oneLine(business)} will be deleted on ${date}`,
    text: `You asked to delete ${business}. The workspace is read-only now, and everything in it (contacts, deals, payments, invoices, users) will be erased for good on ${date}.

You can still export your data from Settings → Data export, and cancel the deletion from Settings → Business until that date.

If you did not ask for this, sign in and cancel it now, then change your password.
${appUrl()}/settings`,
    html: layout(
      "Your business will be deleted",
      `<p style="margin:0 0 14px">You asked to delete <strong>${esc(business)}</strong>. The workspace is read-only now, and everything in it (contacts, deals, payments, invoices, users) will be erased for good on <strong>${date}</strong>.</p><p style="margin:0 0 14px">You can still export your data and cancel the deletion until that date.</p>${button(`${appUrl()}/settings`, "Open settings")}<p style="margin:0;color:#71717a">If you did not ask for this, sign in and cancel it now, then change your password.</p>`,
    ),
  };
}

export function passwordResetEmail(url: string): Rendered {
  return {
    subject: "Reset your CRM password",
    text: `Reset your password:\n${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    html: layout(
      "Reset your password",
      `<p style="margin:0">Use the button below to choose a new password. The link expires in 1 hour.</p>${button(url, "Choose a new password")}<p style="margin:0;color:#71717a">If you didn't request this, you can ignore this email.</p>`,
    ),
  };
}

export function inviteEmail(name: string, url: string): Rendered {
  return {
    subject: "You've been invited to the CRM",
    text: `Hi ${name},\n\nAn administrator created a CRM account for you. Choose your password to get started:\n${url}\n\nThis link expires in 7 days.`,
    html: layout(
      `Welcome, ${name}`,
      `<p style="margin:0">An administrator created a CRM account for you. Use the button below to choose your password. The link expires in 7 days.</p>${button(url, "Set your password")}`,
    ),
  };
}

export function magicLinkEmail(url: string): Rendered {
  return {
    subject: "Your CRM sign-in link",
    text: `Sign in to CRM:\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
    html: layout(
      "Sign in to CRM",
      `<p style="margin:0">Use the button below to sign in. The link expires in 15 minutes.</p>${button(url, "Sign in")}<p style="margin:0;color:#71717a">If you didn't request this, you can ignore this email.</p>`,
    ),
  };
}

const STAGE_LABEL: Record<DealStage, string> = {
  QUALIFICATION: "Inquiry",
  DISCOVERY: "Quote sent",
  PROPOSAL: "Order confirmed",
  NEGOTIATION: "Deposit paid",
  CLOSED_WON: "Completed",
  CLOSED_LOST: "Lost",
};
export const stageLabel = (s: DealStage) => STAGE_LABEL[s];

export function dealStageEmail(d: {
  dealId: string;
  title: string;
  amount: number;
  currency: string;
  from: DealStage;
  to: DealStage;
  actorName: string;
  lostReason?: string | null;
}): Rendered {
  const url = `${appUrl()}/deals`;
  let money: string;
  try {
    money = new Intl.NumberFormat("en-US", { style: "currency", currency: d.currency }).format(d.amount);
  } catch {
    money = `${d.amount} ${d.currency}`;
  }
  const change = `${stageLabel(d.from)} → ${stageLabel(d.to)}`;
  const reason = d.to === "CLOSED_LOST" && d.lostReason ? `\nReason: ${d.lostReason}` : "";
  return {
    subject: `Deal "${oneLine(d.title)}" moved to ${stageLabel(d.to)}`,
    text: `${d.actorName} moved "${d.title}" (${money}): ${change}.${reason}\n\nView the pipeline: ${url}\n`,
    html: layout(
      "Deal stage changed",
      `<p style="margin:0 0 8px"><strong>${esc(d.title)}</strong> (${esc(money)})</p><p style="margin:0 0 8px">${esc(change)}</p><p style="margin:0">Moved by ${esc(d.actorName)}.${d.to === "CLOSED_LOST" && d.lostReason ? ` Reason: ${esc(d.lostReason)}` : ""}</p>${button(url, "View pipeline")}`,
    ),
  };
}

export type DigestTask = { title: string; dueDate: Date; overdue: boolean };

export function taskReminderEmail(name: string, tasks: DigestTask[]): Rendered {
  const url = `${appUrl()}/tasks`;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const lines = tasks.map((t) => `- ${t.title} (${t.overdue ? "overdue, was due" : "due"} ${fmt(t.dueDate)})`);
  const items = tasks
    .map(
      (t) =>
        `<li style="margin-bottom:6px">${esc(t.title)} <span style="color:${t.overdue ? "#b91c1c" : "#71717a"}">(${t.overdue ? "overdue, was due" : "due"} ${fmt(t.dueDate)})</span></li>`,
    )
    .join("");
  const n = tasks.length;
  return {
    subject: n === 1 ? `Task due: ${oneLine(tasks[0].title)}` : `${n} tasks need your attention`,
    text: `Hi ${name},\n\nThese tasks are due soon or overdue:\n${lines.join("\n")}\n\nOpen your tasks: ${url}\n`,
    html: layout(
      "Tasks due soon",
      `<p style="margin:0 0 10px">Hi ${esc(name)}, these tasks are due within a day or already overdue:</p><ul style="margin:0 0 6px;padding-left:20px">${items}</ul>${button(url, "Open tasks")}`,
    ),
  };
}

export type DigestInstalment = { customer: string; dueDate: Date; amountDue: number; currency: string; overdue: boolean };

export function instalmentReminderEmail(name: string, rows: DigestInstalment[]): Rendered {
  const url = `${appUrl()}/deals`;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const amt = (r: DigestInstalment) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency }).format(r.amountDue);
  const when = (r: DigestInstalment) => `${r.overdue ? "overdue, was due" : "due"} ${fmt(r.dueDate)}`;
  const lines = rows.map((r) => `- ${r.customer}: ${amt(r)} (${when(r)})`);
  const items = rows
    .map(
      (r) =>
        `<li style="margin-bottom:6px">${esc(r.customer)}: <strong>${esc(amt(r))}</strong> <span style="color:${r.overdue ? "#b91c1c" : "#71717a"}">(${when(r)})</span></li>`,
    )
    .join("");
  const n = rows.length;
  return {
    subject: n === 1 ? `Payment due: ${oneLine(rows[0].customer)}, ${amt(rows[0])}` : `${n} customer payments need chasing`,
    text: `Hi ${name},\n\nThese instalments are due within a day or already overdue:\n${lines.join("\n")}\n\nOpen the deals board and use each deal's Payments menu: ${url}\n`,
    html: layout(
      "Customer payments due",
      `<p style="margin:0 0 10px">Hi ${esc(name)}, these instalments are due within a day or already overdue:</p><ul style="margin:0 0 6px;padding-left:20px">${items}</ul>${button(url, "Open deals")}`,
    ),
  };
}

export type CustomerInstalmentMail = {
  brand: string;
  firstName: string;
  dealTitle: string;
  amountDue: number;
  currency: string;
  dueDate: Date;
  daysLate: number;
  kind: "UPCOMING" | "OVERDUE_1" | "OVERDUE_2";
  /** A secure online payment link for this amount. Only https links are shown. */
  payUrl?: string;
  /** The business's own subject and message for this notice. A blank part keeps the built-in text. */
  wording?: { subject: string; message: string };
  /** Test mode only: who would really have received this. Shown at the top of the email. */
  testNote?: string;
};

/** Words an admin can put in curly brackets in their own reminder wording. */
export const WORDING_PLACEHOLDERS = ["name", "amount", "deal", "dueDate", "daysLate"] as const;

/** Fills {name}, {amount}, {deal}, {dueDate} and {daysLate}; any other {word} is left as written. */
function fillWording(text: string, vars: Record<(typeof WORDING_PLACEHOLDERS)[number], string>): string {
  return text.replace(/\{(name|amount|deal|dueDate|daysLate)\}/g, (_m, k: keyof typeof vars) => vars[k]);
}

/** An amount with its currency symbol, e.g. $100.00. */
export function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * The automatic reminder a customer gets about an instalment: a friendly note before it is due, a polite
 * one after it is late, and a firmer second notice. It never states payment details (the owner replies
 * with those) and always leaves room for "I have already paid".
 */
export function customerInstalmentEmail(d: CustomerInstalmentMail): Rendered {
  const amt = formatAmount(d.amountDue, d.currency);
  const date = d.dueDate.toISOString().slice(0, 10);
  const deal = oneLine(d.dealTitle);
  const hi = `Hi ${oneLine(d.firstName)},`;
  const bye = `Thank you,\n${d.brand}`;
  const reply = "If you have any questions, just reply to this email.";
  const payUrl = d.payUrl && /^https:\/\/[^\s"'<>]+$/.test(d.payUrl) ? d.payUrl : null;

  let subject: string;
  let title: string;
  let body: string;
  if (d.kind === "UPCOMING") {
    subject = `Payment reminder: ${amt} due ${date}`;
    title = "Payment reminder";
    body = `${hi}\n\nThis is a friendly reminder that your next instalment of ${amt} for "${deal}" is due on ${date}.\n\nIf you have already paid, thank you, and please ignore this message. ${reply}`;
  } else if (d.kind === "OVERDUE_1") {
    subject = `Your payment of ${amt} was due on ${date}`;
    title = "Payment overdue";
    body = `${hi}\n\nWe have not yet received your instalment of ${amt} for "${deal}", which was due on ${date}.\n\nIf you have already paid, thank you, and please let us know so we can check. Otherwise, please arrange the payment as soon as you can. If anything is in the way, reply to this email and we will help.`;
  } else {
    subject = `Second reminder: ${amt} is overdue`;
    title = "Payment overdue";
    body = `${hi}\n\nYour instalment of ${amt} for "${deal}" is now ${d.daysLate} days overdue (it was due on ${date}).\n\nPlease arrange the payment, or reply to this email to tell us when we can expect it. If you have already paid, please send us the details so we can match it to your order.`;
  }

  const own = d.wording;
  if (own?.subject || own?.message) {
    const vars = { name: oneLine(d.firstName), amount: amt, deal, dueDate: date, daysLate: String(d.daysLate) };
    if (own.subject) subject = fillWording(own.subject, vars);
    if (own.message) body = `${hi}

${fillWording(own.message, vars)}`;
  }

  const note = d.testNote ? `[TEST MODE] ${d.testNote}` : "";
  const text = `${body}\n\n${payUrl ? `You can pay securely online here:\n${payUrl}\n\n` : ""}${bye}`;
  return {
    subject: oneLine(subject),
    text: note ? `${note}\n\n${text}` : text,
    html: layout(
      title,
      `${note ? `<p style="margin:0 0 14px;padding:8px 10px;background:#fef3c7;border-radius:6px;font-size:13px">${esc(note)}</p>` : ""}${textToHtml(body)}${payUrl ? button(esc(payUrl), "Pay now") : ""}${textToHtml(bye)}`,
      d.brand,
    ),
  };
}

/** Body of an email composed by a CRM user and sent to a contact (subject comes from the user). */
export function contactEmail(message: string, senderName: string): Pick<Rendered, "text" | "html"> {
  return {
    text: `${message}

-- 
${senderName}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18181b">${textToHtml(message)}<p style="margin:0;color:#71717a">${esc(senderName)}</p></div>`,
  };
}

export type LowStockMail = {
  brand: string;
  rows: { product: string; color: string; lengthInches: number | null; onHand: number; level: number }[];
  /** Low rows that did not fit in the list. */
  more: number;
};

/** The daily low-stock alert for a business's admins: the rows that have just dropped to or below their level. */
export function lowStockEmail(d: LowStockMail): Rendered {
  const total = d.rows.length + d.more;
  const url = `${appUrl()}/stock`;
  const label = (r: LowStockMail["rows"][number]) =>
    `${oneLine(r.product)}${r.color ? ` · ${oneLine(r.color)}` : ""}${r.lengthInches ? ` · ${r.lengthInches}"` : ""}`;
  const subject = `Low stock: ${total} item${total === 1 ? "" : "s"} to reorder`;
  const intro = `${total} stock item${total === 1 ? " has" : "s have"} dropped to or below ${total === 1 ? "its" : "their"} alert level.`;
  const lines = d.rows.map((r) => `- ${label(r)}: ${r.onHand} left (alert at ${r.level})`);
  if (d.more > 0) lines.push(`- ...and ${d.more} more`);
  const text = `${intro}\n\n${lines.join("\n")}\n\nSee all stock: ${url}\n\nYou get one alert each time an item drops this low. It is sent again only after the item has been restocked above its level.`;
  const cell = "padding:6px 8px;border-bottom:1px solid #e4e4e7";
  const rowsHtml = d.rows
    .map(
      (r) =>
        `<tr><td style="${cell}">${esc(label(r))}</td><td style="${cell};text-align:right">${r.onHand}</td><td style="${cell};text-align:right">${r.level}</td></tr>`,
    )
    .join("");
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;font-size:14px"><tr><th align="left" style="${cell}">Item</th><th align="right" style="${cell}">Left</th><th align="right" style="${cell}">Alert at</th></tr>${rowsHtml}</table>${d.more > 0 ? `<p style="margin:0 0 14px">...and ${d.more} more.</p>` : ""}`;
  return {
    subject,
    text,
    html: layout(
      "Low stock",
      `<p style="margin:0 0 14px">${esc(intro)}</p>${table}${button(url, "Open stock")}<p style="margin:0;color:#71717a;font-size:13px">You get one alert each time an item drops this low. It is sent again only after the item has been restocked above its level.</p>`,
      d.brand,
    ),
  };
}

export type IncludedAiNotice = "warn" | "exhausted" | "credit_low";
export type IncludedAiMail = { brand: string; kind: IncludedAiNotice; month: string; allowanceUsd: number; usedUsd: number; creditUsd: number; resetsOn: string };

const usdText = (n: number) => `$${n.toLocaleString("en", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The three notices about included AI (INCLUDED_AI_PLAN.md): 80% of the month's allowance used, all of it used up, or credit running low. */
export function includedAiEmail(d: IncludedAiMail): Rendered {
  const url = `${appUrl()}/settings`;
  const options = "You can buy AI credit in Settings, or add your own Anthropic key there and pay Anthropic directly.";
  let subject: string;
  let intro: string;
  let detail: string;
  if (d.kind === "warn") {
    subject = "Your included AI is 80% used this month";
    intro = `You have used ${usdText(d.usedUsd)} of the ${usdText(d.allowanceUsd)} of AI included in your plan for ${d.month}.`;
    detail = `When it is used up, AI keeps working on any credit you have bought, then pauses until ${d.resetsOn}. ${options}`;
  } else if (d.kind === "exhausted") {
    subject = "Your included AI is used up";
    intro = `The AI included in your plan for ${d.month} is used up, and you have no AI credit left.`;
    detail = `AI is paused until ${d.resetsOn}, when your plan's allowance renews. ${options}`;
  } else {
    subject = `Your AI credit is running low (${usdText(d.creditUsd)} left)`;
    intro = `You have ${usdText(d.creditUsd)} of AI credit left, after this month's included AI.`;
    detail = `When it runs out, AI pauses until ${d.resetsOn}. ${options}`;
  }
  const text = `${intro}\n\n${detail}\n\nOpen settings: ${url}\n\nAI use is counted from token estimates; Anthropic's own record is the source of truth. You get each of these notices at most once.`;
  return {
    subject,
    text,
    html: layout(
      "AI usage",
      `<p style="margin:0 0 14px">${esc(intro)}</p><p style="margin:0 0 14px">${esc(detail)}</p>${button(url, "Open settings")}<p style="margin:0;color:#71717a;font-size:13px">AI use is counted from token estimates; Anthropic's own record is the source of truth. You get each of these notices at most once.</p>`,
      d.brand,
    ),
  };
}
