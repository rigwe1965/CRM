/**
 * The outside providers that may handle personal information, named once so the privacy policy and the data processing
 * addendum cannot drift apart. Keep it true to what the code really calls: add a provider here the day a new one is
 * used. `optional` ones are only involved when a business (or the platform) switches that feature on.
 */
export type Subprocessor = { name: string; role: string; optional?: boolean };

export const SUBPROCESSORS: Subprocessor[] = [
  { name: "Vercel", role: "hosts and runs the application" },
  { name: "Database host", role: "stores all data in a PostgreSQL database [lawyer: name the provider and region]" },
  { name: "Upstash", role: "holds short-lived counters, keyed by IP address and email address, that limit abuse" },
  { name: "Resend", role: "delivers the service's emails (sign-in links, invitations, reminders and messages a business sends)" },
  { name: "Stripe", role: "takes subscription payments, and lets a business take payments from its own customers through its own account", optional: true },
  { name: "Cloudflare (Turnstile)", role: "checks that a sign-up is not from a bot" },
  { name: "Meta (WhatsApp Business)", role: "carries WhatsApp messages for businesses that connect their number", optional: true },
  { name: "Anthropic", role: "runs the AI assistant, through the business's own account", optional: true },
  { name: "Error reporting service", role: "receives crash reports with personal details removed, when the platform has one configured", optional: true },
];
