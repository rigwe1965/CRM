"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, TableSkeleton, useDebounced } from "@/components/common/page";
import { RowMenu } from "@/components/common/items";
import { OrganizationDialog } from "@/components/forms/contact-org-dialogs";
import { initials, shortDate } from "@/lib/client/format";
import { errorMessage, useList, useRemove } from "@/lib/client/hooks";
import type { Organization } from "@/lib/client/types";

type SortKey = "name" | "createdAt";

export default function CompaniesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [deleting, setDeleting] = useState<Organization | null>(null);

  const q = useDebounced(search);
  const { data, isLoading, isFetching, error, refetch } = useList<Organization>("organizations", { page, pageSize: 15, q, sort, order });
  const remove = useRemove("organizations");

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
        title="Companies"
        description="Organizations you sell to or work with."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New company
          </Button>
        }
      />

      <Card>
        <div className="border-b p-4">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search name or domain…"
            className="sm:max-w-xs"
          />
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data && data.data.length === 0 ? (
          q ? (
            <EmptyState icon={Building2} title="No companies match your search" description="Try a different name or domain." action={<Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>} />
          ) : (
            <EmptyState icon={Building2} title="No companies yet" description="Add a company to group its contacts and deals." action={<Button onClick={() => setCreating(true)}><Plus /> New company</Button>} />
          )
        ) : (
          data && (
            <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortHead k="name">Company</SortHead>
                    <TableHead className="hidden md:table-cell">Industry</TableHead>
                    <TableHead className="text-right">Contacts</TableHead>
                    <TableHead className="text-right">Deals</TableHead>
                    <TableHead className="hidden lg:table-cell">Owner</TableHead>
                    <SortHead k="createdAt" className="hidden xl:table-cell">
                      Created
                    </SortHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((o) => (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/companies/${o.id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="rounded-md">
                            <AvatarFallback className="rounded-md">{initials(o.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <Link href={`/companies/${o.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                              {o.name}
                            </Link>
                            {o.domain && <p className="truncate text-xs text-muted-foreground">{o.domain}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{o.industry ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{o._count.contacts}</TableCell>
                      <TableCell className="text-right tabular-nums">{o._count.deals}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{o.owner?.name ?? "Unassigned"}</TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">{shortDate(o.createdAt)}</TableCell>
                      <TableCell>
                        <RowMenu label={o.name} onEdit={() => setEditing(o)} onDelete={() => setDeleting(o)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination meta={data.meta} onPage={setPage} noun="companies" />
            </div>
          )
        )}
      </Card>

      <OrganizationDialog open={creating} onOpenChange={setCreating} />
      {editing && <OrganizationDialog open onOpenChange={(o) => !o && setEditing(null)} organization={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete company?"
        description={deleting ? `${deleting.name} will be removed. Its contacts and deals stay, but lose the company link in lists. An admin can restore it later.` : ""}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Company deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
