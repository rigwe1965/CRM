"use client";

import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, useDeleteSavedFilter, useSavedFilters, useSaveFilter } from "@/lib/client/hooks";
import type { SavedFilter } from "@/lib/client/types";
import { cn } from "@/lib/utils";

type Query = SavedFilter["query"];

/** Drops empty values so two ways of saying "no filter" compare equal. */
const clean = (q: Query): Query => Object.fromEntries(Object.entries(q).filter(([, v]) => !!v)) as Query;
const same = (a: Query, b: Query) => {
  const x = clean(a);
  const y = clean(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k as keyof Query] === y[k as keyof Query]);
};

/**
 * One-click saved filter sets for the contacts list: click a chip to apply it, save the current filters
 * under a name, remove one with the cross. Views are private to the person who made them.
 */
export function SavedViews({ current, onApply }: { current: Query; onApply: (q: Query) => void }) {
  const views = useSavedFilters();
  const save = useSaveFilter();
  const del = useDeleteSavedFilter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const hasFilters = Object.keys(clean(current)).length > 0;
  const list = views.data ?? [];
  if (list.length === 0 && !hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
      <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden />
      {list.map((v) => {
        const active = same(v.query, current);
        return (
          <span key={v.id} className="inline-flex items-center">
            <button type="button" onClick={() => onApply(v.query)} aria-pressed={active} className="rounded-l-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              <Badge variant={active ? "default" : "outline"} className={cn("cursor-pointer rounded-r-none border-r-0", !active && "text-muted-foreground hover:text-foreground")}>
                {v.name}
              </Badge>
            </button>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              disabled={del.isPending}
              onClick={() => del.mutate(v.id, { onError: (e) => toast.error(errorMessage(e)) })}
              className="rounded-r-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Badge variant={active ? "default" : "outline"} className="cursor-pointer rounded-l-none px-1.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </Badge>
            </button>
          </span>
        );
      })}
      {hasFilters && !naming && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(true)}>
          Save this view
        </Button>
      )}
      {naming && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              { name: name.trim(), query: clean(current) },
              {
                onSuccess: () => {
                  toast.success("View saved");
                  setNaming(false);
                  setName("");
                },
                onError: (e2) => toast.error(errorMessage(e2)),
              },
            );
          }}
        >
          <Input value={name} maxLength={40} autoFocus placeholder="Name this view" aria-label="Name for the saved view" className="h-8 w-44" onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" disabled={!name.trim() || save.isPending}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => (setNaming(false), setName(""))}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
