"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";
import { KNOWLEDGE_BASES, KNOWLEDGE_CATEGORIES } from "@/lib/ai/knowledge/types";

type Entry = {
  id: string;
  key: string;
  category: string;
  title: string;
  body: string;
  basis: string;
  keywords: string[];
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  updatedAt: string;
};
type Version = { id: string; version: number; title: string; body: string; status: string; createdAt: string };
type Draft = { key: string; category: string; title: string; body: string; basis: string; keywords: string };

const EMPTY: Draft = { key: "", category: "FAQ", title: "", body: "", basis: "INFO", keywords: "" };
const nice = (s: string) => s.toLowerCase().replaceAll("_", " ");
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm";

/** Admin: the written policy and FAQs AI answers from. Edits take effect at once; every change keeps the earlier text in a version history. */
export function KnowledgeCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["knowledge"],
    queryFn: async () => (await request<{ data: Entry[] }>("GET", "/api/admin/knowledge")).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["knowledge"] });
  const importPolicy = useMutation({
    mutationFn: async () => (await request<{ data: { created: number; updated: number; unchanged: number; skippedEdited: number } }>("POST", "/api/admin/knowledge/import")).data,
    onSuccess: (r) => {
      toast.success(`Policy imported: ${r.created} added, ${r.updated} refreshed, ${r.skippedEdited} edited by you left alone`);
      return refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: async ({ id, draft }: { id: string | null; draft: Draft }) => {
      const body = { category: draft.category, title: draft.title, body: draft.body, basis: draft.basis, keywords: draft.keywords.split(",").map((k) => k.trim()).filter(Boolean) };
      return id ? request("PATCH", `/api/admin/knowledge/${id}`, body) : request("POST", "/api/admin/knowledge", { key: draft.key, ...body });
    },
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null);
      return refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "ARCHIVED" }) => request("PATCH", `/api/admin/knowledge/${id}`, { status }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [history, setHistory] = useState<{ id: string; title: string } | null>(null);
  const versions = useQuery({
    queryKey: ["knowledge-history", history?.id],
    enabled: !!history,
    queryFn: async () => (await request<{ data: Version[] }>("GET", `/api/admin/knowledge/${history!.id}`)).data,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message={error?.message} onRetry={() => refetch()} />;

  const active = data.filter((e) => e.status === "ACTIVE");
  const archived = data.filter((e) => e.status === "ARCHIVED");
  const set = (patch: Partial<Draft>) => setEditing((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur));
  const edit = (e: Entry) => setEditing({ id: e.id, draft: { key: e.key, category: e.category, title: e.title, body: e.body, basis: e.basis, keywords: e.keywords.join(", ") } });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Policy and FAQs</CardTitle>
        <CardDescription>
          What AI answers customer questions from: returns, refunds, exchanges, delivery and anything else you add. AI uses the latest active text, and says a person must decide when nothing here covers a question.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => importPolicy.mutate()} disabled={importPolicy.isPending}>
            {data.length === 0 ? "Import the Ivycandy returns policy" : "Import / refresh default policy"}
          </Button>
          <Button variant="outline" onClick={() => setEditing({ id: null, draft: EMPTY })}>
            Add an entry
          </Button>
        </div>

        {editing && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {editing.id === null && (
                <FormField label="Key" hint="Short lowercase name, e.g. faq-shipping-times. Cannot change later.">
                  <Input value={editing.draft.key} onChange={(e) => set({ key: e.target.value })} />
                </FormField>
              )}
              <FormField label="Title">
                <Input value={editing.draft.title} onChange={(e) => set({ title: e.target.value })} />
              </FormField>
              <FormField label="Category">
                <select className={selectClass} value={editing.draft.category} onChange={(e) => set({ category: e.target.value })}>
                  {KNOWLEDGE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{nice(c)}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Based on" hint="Statutory = a legal right. Voluntary = the store's own policy.">
                <select className={selectClass} value={editing.draft.basis} onChange={(e) => set({ basis: e.target.value })}>
                  {KNOWLEDGE_BASES.map((b) => (
                    <option key={b} value={b}>{nice(b)}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Answer">
              <textarea className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm" value={editing.draft.body} onChange={(e) => set({ body: e.target.value })} />
            </FormField>
            <FormField label="Words customers use" hint="Comma separated, e.g. swap, change length, send back.">
              <Input value={editing.draft.keywords} onChange={(e) => set({ keywords: e.target.value })} />
            </FormField>
            <div className="flex gap-2">
              <Button onClick={() => save.mutate(editing)} disabled={save.isPending}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {data.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet. Import the default policy to get started.</p>}

        <ul className="divide-y rounded-md border">
          {active.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {nice(e.category)} · version {e.version} · updated {new Date(e.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{nice(e.basis)}</Badge>
                <Button size="sm" variant="outline" onClick={() => edit(e)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setHistory({ id: e.id, title: e.title })}>History</Button>
                <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: e.id, status: "ARCHIVED" })}>Archive</Button>
              </div>
            </li>
          ))}
        </ul>

        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Archived (AI ignores these)</p>
            <ul className="divide-y rounded-md border">
              {archived.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 p-3 text-sm text-muted-foreground">
                  <span className="truncate">{e.title}</span>
                  <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: e.id, status: "ACTIVE" })}>Restore</Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history && (
          <div className="space-y-2 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">History: {history.title}</p>
              <Button size="sm" variant="ghost" onClick={() => setHistory(null)}>Close</Button>
            </div>
            {versions.isLoading && <Skeleton className="h-16" />}
            {versions.data?.map((v) => (
              <div key={v.id} className="space-y-1 border-t pt-2 text-sm">
                <p className="text-xs text-muted-foreground">Version {v.version} · {new Date(v.createdAt).toLocaleString()} · {nice(v.status)}</p>
                <p className="whitespace-pre-wrap">{v.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
