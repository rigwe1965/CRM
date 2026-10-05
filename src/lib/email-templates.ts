import type { DealStage } from "@prisma/client";
import { appUrl } from "@/lib/mail";

// Plain template functions: every interpolated value goes through esc() (HTML) or is a URL we built.

type Rendered = { subject: string; text: string; html: string };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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
    subject: `Deal "${d.title}" moved to ${stageLabel(d.to)}`,
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
    subject: n === 1 ? `Task due: ${tasks[0].title}` : `${n} tasks need your attention`,
    text: `Hi ${name},\n\nThese tasks are due soon or overdue:\n${lines.join("\n")}\n\nOpen your tasks: ${url}\n`,
    html: layout(
      "Tasks due soon",
      `<p style="margin:0 0 10px">Hi ${esc(name)}, these tasks are due within a day or already overdue:</p><ul style="margin:0 0 6px;padding-left:20px">${items}</ul>${button(url, "Open tasks")}`,
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
