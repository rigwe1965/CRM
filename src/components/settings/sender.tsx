"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";

type Sender = {
  available: boolean;
  domain: string | null;
  localPart: string | null;
  address: string | null;
  status: "none" | "pending" | "verified" | "failed";
  records: { record: string; type: string; name: string; value: string; priority?: number; status: string }[];
};

const LABEL = { none: "Shared address", pending: "Waiting for DNS", verified: "Verified", failed: "Check failed" } as const;

/** Admin: send customer emails from the business's own domain instead of the CRM's shared address. */
export function SenderCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sender"],
    queryFn: async () => (await request<{ data: Sender }>("GET", "/api/admin/tenant/sender")).data,
  });
  const [draft, setDraft] = useState<{ domain: string; localPart: string } | null>(null);
  const values = draft ?? { domain: data?.domain ?? "", localPart: data?.localPart ?? "hello" };
  const refresh = () => qc.invalidateQueries({ queryKey: ["sender"] });
  const save = useMutation({
    mutationFn: () => request("PUT", "/api/admin/tenant/sender", values),
    onSuccess: () => {
      toast.success("Saved. Add the DNS records below, then press Verify.");
      setDraft(null);
      return refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const verify = useMutation({
    mutationFn: () => request<{ data: Sender }>("POST", "/api/admin/tenant/sender/verify"),
    onSuccess: (r) => {
      toast[r.data.status === "verified" ? "success" : "info"](r.data.status === "verified" ? "Verified. Emails to your customers now come from this address." : "Not verified yet. DNS changes can take a while; try again later.");
      return refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => request("DELETE", "/api/admin/tenant/sender"),
    onSuccess: () => {
      toast.success("Back to the shared address");
      setDraft(null);
      return refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sender address</CardTitle>
        <CardDescription>Emails the CRM sends to your customers (messages from a contact page, instalment reminders) can come from your own domain. Emails about your account, such as invites and sign-in links, always come from the CRM.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : !data.available ? (
          <p className="text-sm text-muted-foreground">Your own sender address is not available on this CRM yet: it needs the Resend email service to be set up by the operator.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={data.status === "verified" ? "default" : data.status === "failed" ? "destructive" : "secondary"}>{LABEL[data.status]}</Badge>
              {data.address && <code className="text-sm">{data.address}</code>}
            </div>
            <form
              className="grid max-w-md gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <FormField label="Domain" hint="A domain or subdomain you own, like mail.yourshop.com. Not gmail.com or similar.">
                <Input value={values.domain} onChange={(e) => setDraft({ ...values, domain: e.target.value })} placeholder="mail.yourshop.com" required />
              </FormField>
              <FormField label="Name before the @" hint="For example hello, orders or sales.">
                <Input value={values.localPart} onChange={(e) => setDraft({ ...values, localPart: e.target.value })} required />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" disabled={save.isPending || !draft}>{data.domain ? "Save changes" : "Save address"}</Button>
                {data.domain && <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>Use the shared address</Button>}
              </div>
            </form>
            {data.domain && data.status !== "verified" && (
              <div className="space-y-3">
                <p className="text-sm">Add these records at the company that manages <strong>{data.domain}</strong>&apos;s DNS, then press Verify. It can take from a few minutes to a day.</p>
                {data.records.length > 0 && (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted">
                        <tr><th className="p-2">Type</th><th className="p-2">Name</th><th className="p-2">Value</th><th className="p-2">Status</th></tr>
                      </thead>
                      <tbody>
                        {data.records.map((r, i) => (
                          <tr key={i} className="border-t align-top">
                            <td className="p-2">{r.type}{r.priority !== undefined && ` (priority ${r.priority})`}</td>
                            <td className="break-all p-2 font-mono">{r.name}</td>
                            <td className="break-all p-2 font-mono">{r.value}</td>
                            <td className="p-2">{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Button disabled={verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? "Checking…" : "Verify"}</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
