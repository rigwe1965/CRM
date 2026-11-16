"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";

type ModelState = { allowed: boolean; own: string | null; businessModel: string; model: string; options: { id: string; label: string; blurb: string }[] };

/**
 * One person's own Claude model, shown at the top of the AI panel only when an admin has allowed people to choose
 * (Settings > AI assistant). "Business default" means they follow the model the admin picked. Saving checks the business's
 * key against the model first, so a choice can never leave AI broken.
 */
export function ModelPicker({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["ivy-model"],
    queryFn: async () => (await request<{ data: ModelState }>("GET", "/api/assistant/model")).data,
    enabled: active,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: (model: string | null) => request("PUT", "/api/assistant/model", { model }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ivy-model"] });
      toast.success("Model saved");
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: ["ivy-model"] });
      toast.error(errorMessage(e));
    },
  });
  const s = state.data;
  if (!s || !s.allowed) return null;
  const businessLabel = s.options.find((o) => o.id === s.businessModel)?.label ?? s.businessModel;
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2 text-xs">
      <label htmlFor="ivy-model" className="shrink-0 text-muted-foreground">
        Model for my questions
      </label>
      <select
        id="ivy-model"
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs"
        value={s.own ?? ""}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.value || null)}
      >
        <option value="">Business default ({businessLabel})</option>
        {s.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
