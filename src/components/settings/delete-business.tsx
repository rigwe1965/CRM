"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { shortDate } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/hooks";

type Status = { requestedAt: string | null; erasedOn: string | null; graceDays: number };

/** Admin: delete the whole business after a grace period. Exporting first is the way to keep a copy. */
export function DeleteBusinessCard({ businessName, internal }: { businessName: string; internal?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["deletion"],
    queryFn: async () => (await request<{ data: Status }>("GET", "/api/admin/tenant/deletion")).data,
  });
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await request<{ user: { mfaEnabled: boolean } }>("GET", "/api/me")).user,
  });
  const [confirmName, setConfirmName] = useState("");
  const [code, setCode] = useState("");
  const done = () => {
    setConfirmName("");
    setCode("");
    // The workspace turns read-only (or writable again), which the signed-in session learns within a minute.
    return qc.invalidateQueries({ queryKey: ["deletion"] });
  };
  const ask = useMutation({
    mutationFn: () => request("POST", "/api/admin/tenant/deletion", { confirmName, code: code.trim() || undefined }),
    onSuccess: () => {
      toast.success("Deletion scheduled");
      return done();
    },
    onError: (e) => {
      setCode("");
      toast.error(errorMessage(e));
    },
  });
  const cancel = useMutation({
    mutationFn: () => request("DELETE", "/api/admin/tenant/deletion"),
    onSuccess: () => {
      toast.success("Deletion cancelled");
      return done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (internal) return null;
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete this business</CardTitle>
        <CardDescription>Erases every contact, deal, payment, invoice and user, for good. Export your data first (Data export tab).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : data.requestedAt ? (
          <>
            <p className="text-sm">
              This business is scheduled to be erased on <strong>{shortDate(data.erasedOn!)}</strong>. Until then it is read-only: you can still export your data.
            </p>
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel the deletion</Button>
          </>
        ) : (
          <form
            className="grid max-w-md gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              The workspace becomes read-only straight away and everything is erased after {data.graceDays} days. You can cancel any time before then. Your subscription is cancelled when the data is erased.
            </p>
            <FormField label={`Type "${businessName}" to confirm`}>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" required />
            </FormField>
            {me?.mfaEnabled && (
              <FormField label="Authenticator code">
                <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
              </FormField>
            )}
            <div>
              <Button type="submit" variant="destructive" disabled={ask.isPending || confirmName.trim() !== businessName}>Delete this business</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
