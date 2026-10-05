"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyState, ErrorState, FilterSelect, PageHeader, Pagination, SearchInput, TableSkeleton, useDebounced } from "@/components/common/page";
import { RowMenu } from "@/components/common/items";
import { ContactDialog } from "@/components/forms/contact-org-dialogs";
import { CONTACT_TYPES, LEAD_STATUSES, contactTypeInfo, leadStatusInfo } from "@/lib/client/constants";
import { fullName, initials, shortDate } from "@/lib/client/format";
import { errorMessage, useList, useRemove } from "@/lib/client/hooks";
import type { Contact } from "@/lib/client/types";

type SortKey = "name" | "createdAt";

export default function ContactsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  const q = useDebounced(search);
  const filtered = !!(q || type || status);
  const { data, isLoading, isFetching, error, refetch } = useList<Contact>("contacts", {
    page,
    pageSize: 15,
    q,
    type,
    leadStatus: status,
    sort,
    order,
  });
  const remove = useRemove("contacts");

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setOrder(key === "name" ? "asc" : "desc");
    }
    setPage(1);
  };
  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className} aria-sort={sort === k ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-foreground">
        {children}
        {sort === k && (order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Leads, prospects and customers."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New contact
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
            placeholder="Search name, email or phone…"
            className="sm:max-w-xs sm:flex-1"
          />
          <FilterSelect
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            allLabel="All types"
            options={CONTACT_TYPES}
          />
          <FilterSelect
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            allLabel="Any lead status"
            options={LEAD_STATUSES}
          />
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data && data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Users}
              title="No contacts match your filters"
              description="Try a different search or clear the filters."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setType("");
                    setStatus("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Add your first lead or customer to get started."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> New contact
                </Button>
              }
            />
          )
        ) : (
          data && (
            <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortHead k="name">Name</SortHead>
                    <TableHead className="hidden md:table-cell">Company</TableHead>
                    <TableHead className="hidden lg:table-cell">Email</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden md:table-cell">Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Owner</TableHead>
                    <SortHead k="createdAt" className="hidden xl:table-cell">
                      Created
                    </SortHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((c) => {
                    const t = contactTypeInfo(c.type);
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/contacts/${c.id}`)}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback>{initials(fullName(c))}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <Link href={`/contacts/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                                {fullName(c)}
                              </Link>
                              {c.title && <p className="truncate text-xs text-muted-foreground">{c.title}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {c.organization ? (
                            <Link href={`/companies/${c.organization.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                              {c.organization.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">{c.email ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={t.tone}>{t.label}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {c.leadStatus ? <Badge variant={leadStatusInfo(c.leadStatus).tone}>{leadStatusInfo(c.leadStatus).label}</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">{c.owner?.name ?? "Unassigned"}</TableCell>
                        <TableCell className="hidden text-muted-foreground xl:table-cell">{shortDate(c.createdAt)}</TableCell>
                        <TableCell>
                          <RowMenu label={fullName(c)} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination meta={data.meta} onPage={setPage} noun="contacts" />
            </div>
          )
        )}
      </Card>

      <ContactDialog open={creating} onOpenChange={setCreating} />
      {editing && <ContactDialog open onOpenChange={(o) => !o && setEditing(null)} contact={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete contact?"
        description={deleting ? `${fullName(deleting)} will be removed from your contacts. An admin can restore it later.` : ""}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Contact deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
