"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, CircleDollarSign, MoveRight, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/input";
import { ConfirmDialog, EmptyState, ErrorState, FormField, PageHeader, SearchInput, useDebounced } from "@/components/common/page";
import { FormShell } from "@/components/forms/form-kit";
import { DealDialog } from "@/components/forms/deal-task-activity-dialogs";
import { PaymentsDialog } from "@/components/forms/payments-dialog";
import { MoreHorizontal } from "lucide-react";
import { DEAL_STAGES } from "@/lib/client/constants";
import { dateOnly, dealsMoney, initials, isOverdue, money, moneyMap } from "@/lib/client/format";
import { errorMessage, useList, useMoveDeal, useRemove } from "@/lib/client/hooks";
import type { Deal, DealStage } from "@/lib/client/types";
import { cn } from "@/lib/utils";

const BOARD_LIMIT = 100;

function DealCardBody({ deal, menu }: { deal: Deal; menu?: React.ReactNode }) {
  const open = deal.stage !== "CLOSED_WON" && deal.stage !== "CLOSED_LOST";
  const overdue = open && isOverdue(deal.expectedCloseDate);
  const subtitle = deal.organization?.name ?? (deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "No company");
  const hairSummary = deal.items?.length
    ? deal.items
        .slice(0, 2)
        .map((i) => [`${i.quantity}×`, i.productType, i.lengthInches ? `${i.lengthInches}"` : null].filter(Boolean).join(" "))
        .join(", ") + (deal.items.length > 2 ? ` +${deal.items.length - 2} more` : "")
    : [deal.quantity ? `${deal.quantity}×` : null, deal.productType, deal.texture, deal.lengthInches ? `${deal.lengthInches}"` : null]
        .filter(Boolean)
        .join(" · ");
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{deal.title}</p>
        {menu}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      {hairSummary && <p className="mt-1 truncate text-xs text-muted-foreground">{hairSummary}</p>}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold tabular-nums">{money(deal.amount, deal.currency)}</span>
        <span className="text-xs text-muted-foreground">{deal.probability}%</span>
      </div>
      {deal.payments && (deal.payments.paid > 0 || deal.payments.nextDue) && (
        <p className={cn("mt-1 text-xs tabular-nums text-muted-foreground", deal.payments.overdue && "font-medium text-destructive")}>
          {deal.payments.balance <= 0
            ? `Paid in full · ${money(deal.payments.paid, deal.currency)}`
            : `${money(deal.payments.paid, deal.currency)} paid · ${money(deal.payments.balance, deal.currency)} left${deal.payments.overdue ? " · overdue" : ""}`}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", overdue && "font-medium text-destructive")}>
          <CalendarClock className="h-3 w-3" />
          {deal.expectedCloseDate ? dateOnly(deal.expectedCloseDate) : "No close date"}
        </span>
        <Avatar className="h-5 w-5" title={deal.owner.name}>
          <AvatarFallback className="text-[9px]">{initials(deal.owner.name)}</AvatarFallback>
        </Avatar>
      </div>
    </>
  );
}

function DealCard({
  deal,
  onEdit,
  onPayments,
  onDelete,
  onMove,
}: {
  deal: Deal;
  onEdit: () => void;
  onPayments: () => void;
  onDelete: () => void;
  onMove: (stage: DealStage) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id, data: { deal } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onEdit}
      className={cn(
        "cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <DealCardBody
        deal={deal}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-1.5 -mt-1 h-6 w-6 shrink-0" aria-label={`Actions for ${deal.title}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPayments}>
                <Wallet /> Payments
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Move to</DropdownMenuLabel>
              {DEAL_STAGES.filter((s) => s.value !== deal.stage).map((s) => (
                <DropdownMenuItem key={s.value} onSelect={() => onMove(s.value)}>
                  <MoveRight /> {s.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </div>
  );
}

function Column({
  stage,
  deals,
  children,
  onAdd,
}: {
  stage: (typeof DEAL_STAGES)[number];
  deals: Deal[];
  children: React.ReactNode;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value });
  return (
    <section aria-label={`${stage.label} stage`} className="flex w-64 shrink-0 snap-start flex-col rounded-xl bg-muted/70">
      <header className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
          <h2 className="text-sm font-semibold">{stage.label}</h2>
          <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground tabular-nums">{deals.length}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAdd} aria-label={`Add deal to ${stage.label}`}>
          <Plus />
        </Button>
      </header>
      <p className="px-3 pb-2 text-xs text-muted-foreground tabular-nums">{moneyMap(dealsMoney(deals))}</p>
      <div
        ref={setNodeRef}
        className={cn("flex min-h-[8rem] flex-1 flex-col gap-2 rounded-b-xl px-2 pb-2 transition-colors", isOver && "bg-accent")}
      >
        {children}
        {deals.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            Drop deals here
          </div>
        )}
      </div>
    </section>
  );
}

function LostReasonDialog({ deal, onClose, onConfirm }: { deal: Deal | null; onClose: () => void; onConfirm: (reason: string) => void }) {
  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">{deal && <LostReasonForm deal={deal} onClose={onClose} onConfirm={onConfirm} />}</DialogContent>
    </Dialog>
  );
}

function LostReasonForm({ deal, onClose, onConfirm }: { deal: Deal; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <FormShell
      title="Mark deal as lost"
      description={`Why was “${deal.title}” lost? This helps you spot patterns later.`}
      submitLabel="Mark as lost"
      pending={false}
      formError={null}
      onCancel={onClose}
      onSubmit={() => onConfirm(reason.trim())}
    >
      <FormField label="Reason (optional)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Price, timing, chose a competitor…" autoFocus />
      </FormField>
    </FormShell>
  );
}

export default function DealsPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const { data, isLoading, error, refetch } = useList<Deal>("deals", { pageSize: BOARD_LIMIT, q, sort: "updatedAt", order: "desc" });
  const move = useMoveDeal();
  const remove = useRemove("deals");

  const [creating, setCreating] = useState<{ stage?: DealStage } | null>(null);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deal | null>(null);
  const [losing, setLosing] = useState<Deal | null>(null);
  const [dragging, setDragging] = useState<Deal | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const byStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>(DEAL_STAGES.map((s) => [s.value, []]));
    data?.data.forEach((d) => map.get(d.stage)?.push(d));
    return map;
  }, [data]);

  const openDeals = (data?.data ?? []).filter((d) => d.stage !== "CLOSED_WON" && d.stage !== "CLOSED_LOST");
  const openTotal = dealsMoney(openDeals);
  const openCount = openDeals.length;

  function requestMove(deal: Deal, stage: DealStage) {
    if (deal.stage === stage) return;
    if (stage === "CLOSED_LOST") setLosing(deal);
    else move.mutate({ id: deal.id, stage }, { onSuccess: () => toast.success(`Moved to ${DEAL_STAGES.find((s) => s.value === stage)!.label}`) });
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const deal = e.active.data.current?.deal as Deal | undefined;
    if (deal && e.over) requestMove(deal, e.over.id as DealStage);
  }

  const noDeals = !isLoading && !error && data?.data.length === 0 && !q;

  return (
    <>
      <PageHeader
        title="Deals"
        description={data ? `${moneyMap(openTotal)} open across ${openCount} ${openCount === 1 ? "deal" : "deals"}` : "Your sales pipeline."}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search deals…" className="w-full sm:w-56" />
            <Button onClick={() => setCreating({})}>
              <Plus /> New deal
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="flex gap-4 overflow-hidden" aria-busy="true" aria-label="Loading deals">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-64 shrink-0" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <ErrorState message={error.message} onRetry={() => refetch()} />
        </Card>
      ) : noDeals ? (
        <Card>
          <EmptyState icon={CircleDollarSign} title="No deals yet" description="Create your first deal, then drag it across the pipeline as it progresses." action={<Button onClick={() => setCreating({})}><Plus /> New deal</Button>} />
        </Card>
      ) : (
        <>
          {data && data.meta.total > BOARD_LIMIT && (
            <p className="mb-3 text-sm text-muted-foreground">Showing the {BOARD_LIMIT} most recently updated of {data.meta.total} deals. Use search to find others.</p>
          )}
          {data?.data.length === 0 && q && <p className="mb-3 text-sm text-muted-foreground">No deals match “{q}”.</p>}
          <DndContext
            sensors={sensors}
            onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.deal as Deal) ?? null)}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
              {DEAL_STAGES.map((stage) => (
                <Column key={stage.value} stage={stage} deals={byStage.get(stage.value) ?? []} onAdd={() => setCreating({ stage: stage.value })}>
                  {(byStage.get(stage.value) ?? []).map((deal) => (
                    <DealCard key={deal.id} deal={deal} onEdit={() => setEditing(deal)} onPayments={() => setPayingId(deal.id)} onDelete={() => setDeleting(deal)} onMove={(s) => requestMove(deal, s)} />
                  ))}
                </Column>
              ))}
            </div>
            <DragOverlay>
              {dragging && (
                <div className="rotate-2 cursor-grabbing rounded-lg border bg-card p-3 shadow-xl">
                  <DealCardBody deal={dragging} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {creating && <DealDialog open onOpenChange={(o) => !o && setCreating(null)} defaults={{ stage: creating.stage }} />}
      {editing && <DealDialog open onOpenChange={(o) => !o && setEditing(null)} deal={editing} />}
      <PaymentsDialog deal={data?.data.find((d) => d.id === payingId) ?? null} onClose={() => setPayingId(null)} />
      <LostReasonDialog
        deal={losing}
        onClose={() => setLosing(null)}
        onConfirm={(reason) => {
          if (losing) move.mutate({ id: losing.id, stage: "CLOSED_LOST", lostReason: reason || undefined }, { onSuccess: () => toast.success("Deal marked as lost") });
          setLosing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete deal?"
        description={deleting ? `“${deleting.title}” will be removed from the pipeline. An admin can restore it later.` : ""}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Deal deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
