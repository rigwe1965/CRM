import { format, formatDistanceToNow, parseISO } from "date-fns";

export const money = (n: number, currency = "USD", compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(n);

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
