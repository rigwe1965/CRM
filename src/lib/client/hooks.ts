"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiClientError, qs, request, type Query } from "./api";
import { DEAL_STAGES } from "./constants";
import type { FulfilmentStatus } from "@/lib/fulfilment";
import type { AutomationsView, AudiencePreview, Campaign, CampaignAudience, CustomerLink, Dashboard, Deal, DuplicateMatch, EmailTemplate, Reports, SavedFilter, Tag, DealStage, Paginated, PaymentLinksView, PaymentsView, ReconcileReport, RemindersView, Stock, Task, TaskStatus, WhatsappTemplate, WhatsappTemplateSlot } from "./types";

export type Resource = "contacts" | "organizations" | "deals" | "tasks" | "activities" | "invoices" | "stock/adjustments";

/** Paginated list. Previous page stays visible while the next one loads. */
export function useList<T>(resource: Resource, params: Query, enabled = true) {
  return useQuery({
    queryKey: [resource, "list", params],
    queryFn: () => request<Paginated<T>>("GET", `/api/${resource}${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useItem<T>(resource: Resource, id: string) {
  return useQuery({
    queryKey: [resource, "item", id],
    queryFn: async () => (await request<{ data: T }>("GET", `/api/${resource}/${id}`)).data,
    enabled: id.length > 0,
    retry: (count, err) => !(err instanceof ApiClientError && err.status < 500) && count < 2,
  });
}

export function useReports(months: number) {
  return useQuery({
    queryKey: ["reports", months],
    queryFn: async () => (await request<{ data: Reports }>("GET", `/api/reports?months=${months}`)).data,
    placeholderData: keepPreviousData,
  });
}

/** Admin-only money-consistency findings; pass `enabled: false` for everyone else. */
export function useReconcile(enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "reconcile"],
    queryFn: async () => (await request<{ data: ReconcileReport }>("GET", "/api/reports/reconcile")).data,
    enabled,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await request<{ data: Dashboard }>("GET", "/api/dashboard")).data,
  });
}

// Data is small and views overlap (a deal appears on the board, the dashboard, a contact page...),
// so after any write we simply refetch whatever is on screen.
const refreshAll = (qc: QueryClient) => qc.invalidateQueries();

export function useSave<T = unknown>(resource: Resource, id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await request<{ data: T }>(id ? "PATCH" : "POST", `/api/${resource}${id ? `/${id}` : ""}`, body)).data,
    onSuccess: () => refreshAll(qc),
  });
}

export function useRemove(resource: Resource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>("DELETE", `/api/${resource}/${id}`),
    // Don't refetch the deleted record itself (it would 404 while a detail page navigates away).
    onSuccess: (_data, id) =>
      qc.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === resource && q.queryKey[1] === "item" && q.queryKey[2] === id) }),
  });
}

export function useConvertContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request("POST", `/api/contacts/${id}/convert`),
    onSuccess: () => refreshAll(qc),
  });
}

/** Whether this contact can be answered on WhatsApp from inside the CRM right now (set up, valid number, inside Meta's 24 hours). */
export function useWhatsappStatus(contactId: string) {
  return useQuery({
    queryKey: ["contacts", "whatsapp", contactId],
    queryFn: async () => (await request<{ data: { configured: boolean; canSend: boolean; canTemplate: boolean } }>("GET", `/api/contacts/${contactId}/whatsapp`)).data,
    enabled: contactId.length > 0,
  });
}

/** Sends an approved WhatsApp template to the contact; the filled-in text is logged on their timeline. */
export function useSendWhatsappTemplate(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { templateId: string; dealId?: string; values?: string[] }) => request("POST", `/api/contacts/${contactId}/whatsapp/template`, body),
    onSuccess: () => refreshAll(qc),
  });
}

export function useSendWhatsapp(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => request("POST", `/api/contacts/${contactId}/whatsapp`, { message }),
    onSuccess: () => refreshAll(qc),
  });
}

export function useSendContactEmail(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { subject: string; message: string }) =>
      request("POST", `/api/contacts/${contactId}/email`, body),
    onSuccess: () => refreshAll(qc), // the email is logged on the contact's timeline
  });
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiClientError ? e.message : "Something went wrong. Please try again.";

// ─── Optimistic updates ─────────────────────────────────

type Snapshot = [readonly unknown[], unknown][];

/** Applies `patch` to matching items in every cached list/item of a resource; returns a rollback snapshot. */
function patchCaches<T extends { id: string }>(
  qc: QueryClient,
  resource: Resource,
  id: string,
  patch: (item: T) => T,
): Snapshot {
  const snapshot: Snapshot = qc.getQueriesData({ queryKey: [resource] }) as Snapshot;
  qc.setQueriesData<Paginated<T>>({ queryKey: [resource, "list"] }, (old) =>
    old ? { ...old, data: old.data.map((x) => (x.id === id ? patch(x) : x)) } : old,
  );
  qc.setQueriesData<T>({ queryKey: [resource, "item", id] }, (old) => (old ? patch(old) : old));
  return snapshot;
}

const rollback = (qc: QueryClient, snapshot: Snapshot | undefined) =>
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));

/** Kanban drag/drop: the card jumps immediately, the server call confirms (or the card snaps back). */
export function useMoveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage, lostReason }: { id: string; stage: DealStage; lostReason?: string }) =>
      request("POST", `/api/deals/${id}/stage`, { stage, lostReason }),
    onMutate: async ({ id, stage, lostReason }) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const now = new Date().toISOString();
      const closed = stage === "CLOSED_WON" || stage === "CLOSED_LOST";
      const probability = DEAL_STAGES.find((s) => s.value === stage)!.probability;
      return {
        snapshot: patchCaches<Deal>(qc, "deals", id, (d) => ({
          ...d,
          stage,
          probability,
          closedAt: closed ? now : null,
          lostReason: stage === "CLOSED_LOST" ? (lostReason ?? null) : null,
        })),
      };
    },
    onError: (e, _vars, ctx) => {
      rollback(qc, ctx?.snapshot);
      toast.error(`Couldn't move deal: ${errorMessage(e)}`);
    },
    onSettled: () => refreshAll(qc),
  });
}

/** Task checkbox: ticks instantly, rolls back on failure. */
export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      request("PATCH", `/api/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      return {
        snapshot: patchCaches<Task>(qc, "tasks", id, (t) => ({
          ...t,
          status,
          completedAt: status === "DONE" ? new Date().toISOString() : null,
        })),
      };
    },
    onError: (e, _vars, ctx) => {
      rollback(qc, ctx?.snapshot);
      toast.error(`Couldn't update task: ${errorMessage(e)}`);
    },
    onSettled: () => refreshAll(qc),
  });
}

// ─── Payments ───────────────────────────────────────────

export function usePayments(dealId: string) {
  return useQuery({
    queryKey: ["deals", "payments", dealId],
    queryFn: async () => (await request<{ data: PaymentsView }>("GET", `/api/deals/${dealId}/payments`)).data,
  });
}

/** Payment writes change the balance shown on the board, so refetch everything on screen. */
function usePaymentMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}

export const useAddPayment = (dealId: string) =>
  usePaymentMutation((body: Record<string, unknown>) => request("POST", `/api/deals/${dealId}/payments`, body));

export const useSetFulfilment = (dealId: string) =>
  usePaymentMutation((body: { status?: FulfilmentStatus; carrier?: string | null; trackingNumber?: string | null }) => request("POST", `/api/deals/${dealId}/fulfilment`, body));

export const useDeletePayment = (dealId: string) =>
  usePaymentMutation((paymentId: string) => request("DELETE", `/api/deals/${dealId}/payments/${paymentId}`));

export type LeadFormView = {
  ownerId: string | null;
  effectiveOwner: { id: string; name: string; email: string } | null;
  users: { id: string; name: string; email: string }[];
  allowedOrigins: string[];
  /** Cloudflare Turnstile site key (public), or null when the CAPTCHA is not set up. */
  captchaSiteKey: string | null;
};

export function useLeadForm() {
  return useQuery({
    queryKey: ["lead-form"],
    queryFn: async () => (await request<{ data: LeadFormView }>("GET", "/api/admin/lead-form")).data,
  });
}

export function useSaveLeadForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ownerId: string | null) => request("PUT", "/api/admin/lead-form", { ownerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-form"] }),
  });
}

export function useAutomations() {
  return useQuery({
    queryKey: ["automations"],
    queryFn: async () => (await request<{ data: AutomationsView }>("GET", "/api/admin/automations")).data,
  });
}

export function useSaveAutomations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Pick<AutomationsView, "stageTasks" | "quietLeads" | "instalmentEmails" | "lowStock" | "shippingUpdates">>) =>
      (await request<{ data: AutomationsView }>("PUT", "/api/admin/automations", body)).data,
    onSuccess: (data) => qc.setQueryData(["automations"], data),
  });
}

/** Contacts that look like the one described (same phone or same name). Nothing is asked until there is something to compare. */
export function useDuplicates(q: { firstName: string; lastName: string; phone: string; email: string; excludeId?: string }) {
  const hasName = q.firstName.trim().length > 0 && q.lastName.trim().length > 0;
  const hasPhone = q.phone.replace(/\D/g, "").length >= 7;
  const hasEmail = q.email.includes("@");
  return useQuery({
    queryKey: ["contacts", "duplicates", q],
    queryFn: async () => (await request<{ data: DuplicateMatch[] }>("GET", `/api/contacts/duplicates${qs(q)}`)).data,
    enabled: hasName || hasPhone || hasEmail,
  });
}

/** Admin: fold one contact into another. */
export function useMergeContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) => request("POST", `/api/contacts/${id}/merge`, { intoId }),
    onSuccess: () => refreshAll(qc),
  });
}

/** Lists that change rarely (tags, templates): reuse them for 5 minutes instead of 30 seconds. */
const SLOW_CHANGING = 5 * 60_000;

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => (await request<{ data: Tag[] }>("GET", "/api/tags")).data,
    staleTime: SLOW_CHANGING, // edits here invalidate it, so only another user's change waits
  });
}

/** Creates a tag, or returns the existing one with that name. */
export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await request<{ data: Tag }>("POST", "/api/tags", { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
}

export function useRenameTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => (await request<{ data: Tag }>("PATCH", `/api/tags/${id}`, { name })).data,
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>("DELETE", `/api/tags/${id}`),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useSavedFilters() {
  return useQuery({
    queryKey: ["saved-filters", "contacts"],
    queryFn: async () => (await request<{ data: SavedFilter[] }>("GET", "/api/saved-filters?entity=contacts")).data,
  });
}

export function useSaveFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; query: SavedFilter["query"] }) =>
      (await request<{ data: SavedFilter }>("POST", "/api/saved-filters", { entity: "contacts", ...body })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters"] }),
  });
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>("DELETE", `/api/saved-filters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters"] }),
  });
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => (await request<{ data: EmailTemplate[] }>("GET", "/api/email-templates")).data,
    staleTime: SLOW_CHANGING,
  });
}

export function useSaveEmailTemplate(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name?: string; subject?: string; body?: string }) =>
      (await request<{ data: EmailTemplate }>(id ? "PATCH" : "POST", `/api/email-templates${id ? `/${id}` : ""}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-templates"] }),
  });
}

export function useWhatsappTemplates() {
  return useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: async () => (await request<{ data: WhatsappTemplate[] }>("GET", "/api/whatsapp-templates")).data,
    staleTime: SLOW_CHANGING,
  });
}

/** Copies the templates and their approval status from Meta. */
export function useSyncWhatsappTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await request<{ data: { created: number; updated: number; removed: number } }>("POST", "/api/whatsapp-templates/sync")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-templates"] }),
  });
}

export function useUpdateWhatsappTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { active?: boolean; slots?: WhatsappTemplateSlot[] }) => (await request<{ data: WhatsappTemplate }>("PATCH", `/api/whatsapp-templates/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-templates"] }),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>("DELETE", `/api/email-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-templates"] }),
  });
}

export const useSendSampleEmail = () =>
  useMutation({
    mutationFn: async (body: { to: string; brandName: string; kind: "UPCOMING" | "OVERDUE_1" | "OVERDUE_2"; wording?: { subject: string; message: string } }) =>
      (await request<{ data: { to: string; consoleOnly: boolean } }>("POST", "/api/admin/automations/sample-email", body)).data,
  });

export function usePaymentLinks(dealId: string) {
  return useQuery({
    queryKey: ["deals", "payment-links", dealId],
    queryFn: async () => (await request<{ data: PaymentLinksView }>("GET", `/api/deals/${dealId}/payment-links`)).data,
  });
}

export const useCreatePaymentLink = (dealId: string) =>
  usePaymentMutation((body: { amount?: number; note?: string | null }) => request("POST", `/api/deals/${dealId}/payment-links`, body));

export const useCancelPaymentLink = (dealId: string) =>
  usePaymentMutation((linkId: string) => request("DELETE", `/api/deals/${dealId}/payment-links/${linkId}`));

export function useCustomerLink(dealId: string) {
  return useQuery({
    queryKey: ["deals", "customer-link", dealId],
    queryFn: async () => (await request<{ data: { link: CustomerLink | null } }>("GET", `/api/deals/${dealId}/customer-link`)).data.link,
  });
}

function useCustomerLinkMutation<V>(dealId: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["deals", "customer-link", dealId] }) });
}

export const useCreateCustomerLink = (dealId: string) => useCustomerLinkMutation(dealId, (v: { expiresInDays?: number } | void) => request("POST", `/api/deals/${dealId}/customer-link`, v ?? {}));

export const useRevokeCustomerLink = (dealId: string) => useCustomerLinkMutation(dealId, () => request("DELETE", `/api/deals/${dealId}/customer-link`));

export function useReminders(dealId: string) {
  return useQuery({
    queryKey: ["deals", "reminders", dealId],
    queryFn: async () => (await request<{ data: RemindersView }>("GET", `/api/deals/${dealId}/reminders`)).data,
  });
}

export const useSendReminder = (dealId: string) =>
  usePaymentMutation((v: { instalmentId: string; channel: "EMAIL" | "WHATSAPP" }) => request("POST", `/api/deals/${dealId}/reminders`, v));

export const useSaveSchedule = (dealId: string) =>
  usePaymentMutation((instalments: { dueDate: string; amount: number }[]) =>
    request("PUT", `/api/deals/${dealId}/schedule`, { instalments }),
  );

export function useStock() {
  return useQuery({
    queryKey: ["stock"],
    queryFn: async () => (await request<{ data: Stock }>("GET", "/api/stock")).data,
  });
}

/** Sets when one stock row counts as low. `threshold` null = business default, 0 = never alert. */
export function useSetStockLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { product: string; color: string; lengthInches: number | null; threshold: number | null }) =>
      request("PUT", "/api/stock/thresholds", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

// ─── Broadcast campaigns (admin) ────────────────────────

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => (await request<{ data: Campaign[] }>("GET", "/api/admin/campaigns")).data,
  });
}

type CampaignInput = { name: string; templateId: string; audience: CampaignAudience; values: string[] };

export function useSaveCampaign(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CampaignInput) => (await request<{ data: Campaign }>(id ? "PATCH" : "POST", id ? `/api/admin/campaigns/${id}` : "/api/admin/campaigns", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => request("DELETE", `/api/admin/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

/** Who the filter would reach. Re-asked (after a short pause, by the caller) whenever the filter changes. */
export function useAudiencePreview(audience: CampaignAudience) {
  return useQuery({
    queryKey: ["campaigns", "audience", audience],
    queryFn: async () => (await request<{ data: AudiencePreview }>("GET", `/api/admin/campaigns/audience?audience=${encodeURIComponent(JSON.stringify(audience))}`)).data,
    placeholderData: keepPreviousData,
  });
}
