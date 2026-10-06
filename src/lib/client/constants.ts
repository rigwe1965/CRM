import type {
  ActivityType,
  ContactType,
  DealStage,
  InvoiceStatus,
  PaymentMethod,
  LeadStatus,
  TaskPriority,
  TaskStatus,
} from "./types";

export type BadgeTone = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "info";

export const CONTACT_TYPES: { value: ContactType; label: string; tone: BadgeTone }[] = [
  { value: "LEAD", label: "Lead", tone: "info" },
  { value: "PROSPECT", label: "Interested Buyer", tone: "warning" },
  { value: "CUSTOMER", label: "Customer", tone: "success" },
  { value: "PARTNER", label: "Reseller / Partner", tone: "default" },
  { value: "OTHER", label: "Other", tone: "secondary" },
];

export const LEAD_STATUSES: { value: LeadStatus; label: string; tone: BadgeTone }[] = [
  { value: "NEW", label: "New Inquiry", tone: "info" },
  { value: "CONTACTED", label: "In Conversation", tone: "warning" },
  { value: "QUALIFIED", label: "Ready to Order", tone: "success" },
  { value: "UNQUALIFIED", label: "Not a Fit", tone: "secondary" },
];

export const DEAL_STAGES: {
  value: DealStage;
  label: string;
  probability: number;
  color: string;
  tone: BadgeTone;
}[] = [
  { value: "QUALIFICATION", label: "Inquiry", probability: 10, color: "#94a3b8", tone: "secondary" },
  { value: "DISCOVERY", label: "Quote Sent", probability: 25, color: "#38bdf8", tone: "info" },
  { value: "PROPOSAL", label: "Order Confirmed", probability: 50, color: "#818cf8", tone: "default" },
  { value: "NEGOTIATION", label: "Deposit Paid", probability: 75, color: "#f59e0b", tone: "warning" },
  { value: "CLOSED_WON", label: "Completed", probability: 100, color: "#10b981", tone: "success" },
  { value: "CLOSED_LOST", label: "Lost", probability: 0, color: "#f87171", tone: "destructive" },
];

export const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
];

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DONE", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string; tone: BadgeTone }[] = [
  { value: "LOW", label: "Low", tone: "secondary" },
  { value: "MEDIUM", label: "Medium", tone: "info" },
  { value: "HIGH", label: "High", tone: "warning" },
  { value: "URGENT", label: "Urgent", tone: "destructive" },
];

export const stageInfo = (s: DealStage) => DEAL_STAGES.find((x) => x.value === s)!;
export const contactTypeInfo = (t: ContactType) => CONTACT_TYPES.find((x) => x.value === t)!;
export const priorityInfo = (p: TaskPriority) => TASK_PRIORITIES.find((x) => x.value === p)!;
export const leadStatusInfo = (s: LeadStatus) => LEAD_STATUSES.find((x) => x.value === s)!;

export const INVOICE_STATUSES: { value: InvoiceStatus; label: string; tone: BadgeTone }[] = [
  { value: "DRAFT", label: "Draft", tone: "secondary" },
  { value: "SENT", label: "Sent", tone: "info" },
  { value: "PAID", label: "Paid", tone: "success" },
  { value: "CANCELLED", label: "Cancelled", tone: "destructive" },
];

export const invoiceStatusInfo = (s: InvoiceStatus) => INVOICE_STATUSES.find((x) => x.value === s)!;

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "DIGITAL", label: "Card / Cash App / Zelle / PayPal" },
  { value: "OTHER", label: "Other" },
];

export const paymentMethodLabel = (m: PaymentMethod) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;
