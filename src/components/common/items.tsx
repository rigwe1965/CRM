"use client";

import Link from "next/link";
import { CalendarClock, Mail, MoreHorizontal, Pencil, Phone, StickyNote, Trash2, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { priorityInfo, stageInfo } from "@/lib/client/constants";
import { dateOnly, fullName, isOverdue, timeAgo } from "@/lib/client/format";
import { useSetTaskStatus } from "@/lib/client/hooks";
import type { Activity, ActivityType, Deal, Task } from "@/lib/client/types";
import { cn } from "@/lib/utils";

export function RowMenu({ onEdit, onDelete, label }: { onEdit?: () => void; onDelete?: () => void; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${label}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Edit
          </DropdownMenuItem>
        )}
        {onDelete && (
          <DropdownMenuItem destructive onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Tasks ──────────────────────────────────────────────

export function TaskRow({ task, onEdit, onDelete }: { task: Task; onEdit?: () => void; onDelete?: () => void }) {
  const setStatus = useSetTaskStatus();
  const done = task.status === "DONE";
  const cancelled = task.status === "CANCELLED";
  const overdue = !done && !cancelled && isOverdue(task.dueDate);
  const prio = priorityInfo(task.priority);

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
      <Checkbox
        className="mt-1"
        checked={done}
        disabled={cancelled}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onCheckedChange={(c) => setStatus.mutate({ id: task.id, status: c ? "DONE" : "TODO" })}
      />
      <div className="min-w-0 flex-1">
        {onEdit ? (
          <button type="button" onClick={onEdit} className={cn("text-left text-sm font-medium hover:underline", (done || cancelled) && "text-muted-foreground line-through")}>
            {task.title}
          </button>
        ) : (
          <span className={cn("text-sm font-medium", (done || cancelled) && "text-muted-foreground line-through")}>{task.title}</span>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.dueDate && (
            <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
              <CalendarClock className="h-3 w-3" />
              {overdue ? "Overdue · " : "Due "}
              {dateOnly(task.dueDate)}
            </span>
          )}
          {task.contact && (
            <Link href={`/contacts/${task.contact.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              <Users className="h-3 w-3" />
              {fullName(task.contact)}
            </Link>
          )}
          {task.deal && (
            <Link href="/deals" className="hover:text-foreground hover:underline">
              {task.deal.title}
            </Link>
          )}
          {cancelled && <span>Cancelled</span>}
        </div>
      </div>
      <Badge variant={prio.tone} className="hidden sm:inline-flex">
        {prio.label}
      </Badge>
      {(onEdit || onDelete) && <RowMenu label={task.title} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
}

// ─── Activities ─────────────────────────────────────────

const ACTIVITY_ICON: Record<ActivityType, { icon: LucideIcon; className: string }> = {
  NOTE: { icon: StickyNote, className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  CALL: { icon: Phone, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  EMAIL: { icon: Mail, className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  MEETING: { icon: Users, className: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
};

export function ActivityItem({
  activity,
  onEdit,
  onDelete,
  showLinks = true,
}: {
  activity: Activity;
  onEdit?: () => void;
  onDelete?: () => void;
  showLinks?: boolean;
}) {
  const { icon: Icon, className } = ACTIVITY_ICON[activity.type];
  return (
    <div className="flex gap-3 px-4 py-3">
      <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", className)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{activity.subject}</p>
        {activity.body && <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{activity.body}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{activity.author.name}</span>
          <span>·</span>
          <span>{timeAgo(activity.occurredAt)}</span>
          {showLinks && activity.contact && (
            <>
              <span>·</span>
              <Link href={`/contacts/${activity.contact.id}`} className="hover:text-foreground hover:underline">
                {fullName(activity.contact)}
              </Link>
            </>
          )}
          {showLinks && activity.organization && (
            <>
              <span>·</span>
              <Link href={`/companies/${activity.organization.id}`} className="hover:text-foreground hover:underline">
                {activity.organization.name}
              </Link>
            </>
          )}
          {showLinks && activity.deal && (
            <>
              <span>·</span>
              <Link href="/deals" className="hover:text-foreground hover:underline">
                {activity.deal.title}
              </Link>
            </>
          )}
        </p>
      </div>
      {(onEdit || onDelete) && <RowMenu label={activity.subject} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
}

// ─── Deals ──────────────────────────────────────────────

export function DealMiniRow({ deal, onClick }: { deal: Deal; onClick?: () => void }) {
  const stage = stageInfo(deal.stage);
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{deal.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {deal.organization?.name ?? "No company"}
          {deal.expectedCloseDate ? ` · closes ${dateOnly(deal.expectedCloseDate)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge variant={stage.tone}>{stage.label}</Badge>
        <span className="text-sm font-medium tabular-nums">
          {new Intl.NumberFormat("en-US", { style: "currency", currency: deal.currency, maximumFractionDigits: 0 }).format(deal.amount)}
        </span>
      </div>
    </button>
  );
}
