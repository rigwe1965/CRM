"use client";

import { useState } from "react";
import { CheckSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, SearchInput, useDebounced } from "@/components/common/page";
import { TaskRow } from "@/components/common/items";
import { TaskDialog } from "@/components/forms/deal-task-activity-dialogs";
import { TASK_PRIORITIES } from "@/lib/client/constants";
import { errorMessage, useList, useRemove } from "@/lib/client/hooks";
import type { Task } from "@/lib/client/types";

type View = "open" | "overdue" | "done" | "all";

const VIEW_QUERY: Record<View, Record<string, string | boolean>> = {
  open: { status: "TODO,IN_PROGRESS" },
  overdue: { overdue: true },
  done: { status: "DONE" },
  all: {},
};

const EMPTY_COPY: Record<View, { title: string; description: string }> = {
  open: { title: "You're all caught up", description: "No open tasks. Enjoy it, or add a new one." },
  overdue: { title: "Nothing overdue", description: "Every task with a due date is on track." },
  done: { title: "No completed tasks yet", description: "Tick a task off and it will show up here." },
  all: { title: "No tasks yet", description: "Create a task to keep track of follow-ups." },
};

export default function TasksPage() {
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const q = useDebounced(search);
  const { data, isLoading, isFetching, error, refetch } = useList<Task>("tasks", {
    page,
    pageSize: 20,
    q,
    priority,
    sort: view === "done" ? "createdAt" : "dueDate",
    order: view === "done" ? "desc" : "asc",
    ...VIEW_QUERY[view],
  });
  const remove = useRemove("tasks");
  const filtered = !!(q || priority);

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups for you and your deals."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <Tabs
            value={view}
            onValueChange={(v) => {
              setView(v as View);
              setPage(1);
            }}
          >
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="overdue">Overdue</TabsTrigger>
              <TabsTrigger value="done">Completed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search tasks…"
              className="sm:max-w-xs sm:flex-1"
            />
            <FilterSelect
              value={priority}
              onChange={(v) => {
                setPriority(v);
                setPage(1);
              }}
              allLabel="Any priority"
              options={TASK_PRIORITIES}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="divide-y" aria-busy="true" aria-label="Loading tasks">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-64" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data && data.data.length === 0 ? (
          filtered ? (
            <EmptyState icon={CheckSquare} title="No tasks match your filters" action={<Button variant="outline" onClick={() => { setSearch(""); setPriority(""); }}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={CheckSquare}
              {...EMPTY_COPY[view]}
              action={view === "open" || view === "all" ? <Button onClick={() => setCreating(true)}><Plus /> New task</Button> : undefined}
            />
          )
        ) : (
          data && (
            <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
              <div className="divide-y">
                {data.data.map((t) => (
                  <TaskRow key={t.id} task={t} onEdit={() => setEditing(t)} onDelete={() => setDeleting(t)} />
                ))}
              </div>
              <Pagination meta={data.meta} onPage={setPage} noun="tasks" />
            </div>
          )
        )}
      </Card>

      <TaskDialog open={creating} onOpenChange={setCreating} />
      {editing && <TaskDialog open onOpenChange={(o) => !o && setEditing(null)} task={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete task?"
        description={deleting ? `“${deleting.title}” will be permanently deleted.` : ""}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Task deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
