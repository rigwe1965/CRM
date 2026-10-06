import { format, formatDistanceToNow, parseISO } from "date-fns";
import type { MoneyMap } from "@/lib/money";

export const money = (n: number, currency = "USD", compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(n);

/** "$7,309 + €620": one figure per currency, never added together. USD first, then A to Z. */
export const moneyMap = (m: MoneyMap, fallback = "USD", compact = false) => {
  const entries = Object.entries(m)
    .filter(([, n]) => n !== 0)
    .sort(([a], [b]) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  return entries.length ? entries.map(([cur, n]) => money(n, cur, compact)).join(" + ") : money(0, fallback, compact);
};

/** Totals of deals per currency. */
export const dealsMoney = (deals: { amount: number; currency: string }[]): MoneyMap => {
  const out: MoneyMap = {};
  for (const d of deals) out[d.currency] = Math.round(((out[d.currency] ?? 0) + d.amount) * 100) / 100;
  return out;
};

/** Timestamps (createdAt, occurredAt...): shown in the viewer's timezone. */
export const shortDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), "MMM d, yyyy") : "—");
export const dateTime = (iso: string) => format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
export const timeAgo = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

/**
 * Calendar dates (due / expected close): the API stores them as UTC midnight, so use the
 * yyyy-mm-dd part as-is instead of converting to local time (which can shift the day).
 */
export const dateOnly = (iso: string | null | undefined) =>
  iso ? format(parseISO(iso.slice(0, 10)), "MMM d, yyyy") : "—";
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/** Overdue if the due date is before today (due today is not overdue yet). */
export const isOverdue = (iso: string | null | undefined) =>
  !!iso && iso.slice(0, 10) < format(new Date(), "yyyy-MM-dd");

export const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
