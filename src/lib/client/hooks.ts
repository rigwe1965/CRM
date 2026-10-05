"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiClientError, qs, request, type Query } from "./api";
import { DEAL_STAGES } from "./constants";
import type { Dashboard, Deal, DealStage, Paginated, Task, TaskStatus } from "./types";

export type Resource = "contacts" | "organizations" | "deals" | "tasks" | "activities";

/** Paginated list. Previous page stays visible while the next one loads. */
export function useList<T>(resource: Resource, params: Query) {
  return useQuery({
    queryKey: [resource, "list", params],
    queryFn: () => request<Paginated<T>>("GET", `/api/${resource}${qs(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useItem<T>(resource: Resource, id: string) {
  return useQuery({
    queryKey: [resource, "item", id],
    queryFn: async () => (await request<{ data: T }>("GET", `/api/${resource}/${id}`)).data,
    retry: (count, err) => !(err instanceof ApiClientError && err.status < 500) && count < 2,
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
