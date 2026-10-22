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
import { errorMessage } from "@/lib/client/hooks";
import { DeleteBusinessCard } from "@/components/settings/delete-business";

type Business = { id: string; name: string; brandName: string | null; senderName: string | null; plan: string };

/** Admin: how the business presents itself to its customers. */
export function BusinessCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["business"],
    queryFn: async () => (await request<{ data: Business }>("GET", "/api/admin/tenant")).data,
  });
  const [draft, setDraft] = useState<{ name: string; brandName: string; senderName: string } | null>(null);
  const values = draft ?? { name: data?.name ?? "", brandName: data?.brandName ?? "", senderName: data?.senderName ?? "" };
  const save = useMutation({
    mutationFn: (body: typeof values) => request("PATCH", "/api/admin/tenant", body),
    onSuccess: () => {
      toast.success("Business details saved");
      setDraft(null);
      return qc.invalidateQueries({ queryKey: ["business"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Business</CardTitle>
        <CardDescription>The name your customers see in the emails the CRM sends for you.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : (
          <form
            className="max-w-md space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(values);
            }}
          >
            <FormField label="Business name">
              <Input value={values.name} onChange={(e) => setDraft({ ...values, name: e.target.value })} required maxLength={80} />
            </FormField>
            <FormField label="Brand name" hint="Shown to customers, for example in payment reminders. Defaults to the business name.">
              <Input value={values.brandName} onChange={(e) => setDraft({ ...values, brandName: e.target.value })} maxLength={80} />
            </FormField>
            <FormField label="Sender name" hint="The name your emails come from. Emails are sent from the CRM's own address.">
              <Input value={values.senderName} onChange={(e) => setDraft({ ...values, senderName: e.target.value })} maxLength={80} />
            </FormField>
            <Button type="submit" disabled={save.isPending || !draft || !values.name.trim()}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
    {data && <DeleteBusinessCard businessName={data.name} internal={data.plan === "internal"} />}
    </div>
  );
}
