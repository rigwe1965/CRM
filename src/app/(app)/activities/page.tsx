"use client";

import { useState } from "react";
import { Activity as ActivityIcon, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, SearchInput, useDebounced } from "@/components/common/page";
import { ActivityItem } from "@/components/common/items";
import { ActivityDialog } from "@/components/forms/deal-task-activity-dialogs";
import { ACTIVITY_TYPES } from "@/lib/client/constants";
import { errorMessage, useList, useRemove } from "@/lib/client/hooks";
import type { Activity } from "@/lib/client/types";

export default function ActivitiesPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [deleting, setDeleting] = useState<Activity | null>(null);

  const q = useDebounced(search);
  const { data, isLoading, isFetching, error, refetch } = useList<Activity>("activities", { page, pageSize: 20, q, type, sort: "occurredAt", order: "desc" });
  const remove = useRemove("activities");
  const filtered = !!(q || type);

  return (
    <>
      <PageHeader
        title="Activities"
        description="Calls, emails, meetings and notes."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Log activity
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search subject or details…"
            className="sm:max-w-xs sm:flex-1"
          />
          <FilterSelect
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            allLabel="All types"
            options={ACTIVITY_TYPES}
          />
        </div>

        {isLoading ? (
          <div className="divide-y" aria-busy="true" aria-label="Loading activities">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-4">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-80 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data && data.data.length === 0 ? (
          filtered ? (
            <EmptyState icon={ActivityIcon} title="No activities match your filters" action={<Button variant="outline" onClick={() => { setSearch(""); setType(""); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={ActivityIcon} title="No activity logged yet" description="Record a call, email, meeting or note to build a history." action={<Button onClick={() => setCreating(true)}><Plus /> Log activity</Button>} />
          )
        ) : (
          data && (
            <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
              <div className="divide-y">
                {data.data.map((a) => (
                  <ActivityItem key={a.id} activity={a} onEdit={() => setEditing(a)} onDelete={() => setDeleting(a)} />
                ))}
              </div>
              <Pagination meta={data.meta} onPage={setPage} noun="activities" />
            </div>
          )
        )}
      </Card>

      <ActivityDialog open={creating} onOpenChange={setCreating} />
      {editing && <ActivityDialog open onOpenChange={(o) => !o && setEditing(null)} activity={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete activity?"
        description={deleting ? `“${deleting.subject}” will be permanently deleted.` : ""}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Activity deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
