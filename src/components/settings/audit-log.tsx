"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, Pagination, SearchInput, useDebounced } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

type Entry = {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  summary: string | null;
  data: unknown;
  ip: string | null;
};
type Page = { data: Entry[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };

/** Admin-only, read-only list of everything done in the CRM. Deleted records keep a snapshot in the details. */
export function AuditLogCard() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Entry | null>(null);
  const search = useDebounced(q);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit", search, page],
    queryFn: () => request<Page>("GET", `/api/admin/audit?page=${page}&q=${encodeURIComponent(search)}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Every sign-in, account change and edit, with who did it and when. Entries cannot be edited or deleted here.</CardDescription>
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search action, person or record id…"
          className="max-w-sm pt-2"
        />
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {isLoading ? (
          <Skeleton className="mx-5 mb-5 h-40" />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpen(e)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(e.createdAt)}</TableCell>
                    <TableCell>{e.actorEmail ?? "—"}</TableCell>
                    <TableCell>
                      <p className="font-medium">{e.action}</p>
                      {e.summary && <p className="text-xs text-muted-foreground">{e.summary}</p>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{e.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data && <Pagination meta={data.meta} onPage={setPage} noun="entries" />}
          </>
        )}
      </CardContent>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.action}</DialogTitle>
            <DialogDescription>
              {open && `${dateTime(open.createdAt)} · ${open.actorEmail ?? "no user"}${open.entity ? ` · ${open.entity} ${open.entityId ?? ""}` : ""}`}
            </DialogDescription>
          </DialogHeader>
          {open?.data ? (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(open.data, null, 2)}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">No extra details were recorded.</p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
