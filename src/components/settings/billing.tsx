"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { shortDate } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/hooks";

type Billing = {
  configured: boolean;
  plan: string;
  planLabel: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  writable: boolean;
  readOnlyReason: "trial_ended" | "canceled" | "suspended" | "deletion_pending" | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  hasSubscription: boolean;
  limits: { users: number | null; contacts: number | null };
  usage: { users: number; contacts: number };
  plans: { key: "starter" | "pro"; label: string; limits: { users: number | null; contacts: number | null }; available: boolean; prices: { currency: string; amount: number }[]; plusTax: boolean }[];
};

const count = (n: number | null) => (n === null ? "unlimited" : n.toLocaleString("en"));
const money = (amount: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);

/** Admin: the plan, trial or subscription, what is used against the limits, and how to pay or manage it. */
export function BillingCard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing"],
    queryFn: async () => (await request<{ data: Billing }>("GET", "/api/billing")).data,
  });
  // Empty until chosen: Stripe then picks the currency from where the buyer is.
  const [currency, setCurrency] = useState("");
  const currencies = [...new Set((data?.plans ?? []).flatMap((p) => p.prices.map((x) => x.currency)))];
  const go = useMutation({
    mutationFn: (target: { path: string; body?: unknown }) => request<{ data: { url: string } }>("POST", target.path, target.body),
    onSuccess: (r) => {
      window.location.href = r.data.url;
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>Your plan and what you are using. Payments are handled by Stripe; we never see your card.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold">{data.planLabel}</span>
              <Badge variant={data.writable ? "default" : "destructive"}>
                {data.plan === "internal" ? "Internal" : data.status === "TRIALING" ? "Free trial" : data.status === "ACTIVE" ? "Active" : data.status === "PAST_DUE" ? "Payment failed" : "Cancelled"}
              </Badge>
            </div>

            {data.status === "TRIALING" && data.trialDaysLeft !== null && (
              <p className="text-sm">
                {data.writable ? `${data.trialDaysLeft} day${data.trialDaysLeft === 1 ? "" : "s"} left in your free trial.` : "Your free trial has ended."}
              </p>
            )}
            {data.status === "PAST_DUE" && <p className="text-sm text-destructive">Your last payment failed. Update your card to keep your plan.</p>}
            {data.status === "CANCELED" && data.currentPeriodEnd && (
              <p className="text-sm">{data.writable ? `Your plan ends on ${shortDate(data.currentPeriodEnd)}.` : `Your plan ended on ${shortDate(data.currentPeriodEnd)}.`}</p>
            )}
            {!data.writable && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">The workspace is read-only. You can still view and export everything. Choose a plan to start editing again.</p>}

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Users</p>
                <p className="text-lg font-medium">{data.usage.users} of {count(data.limits.users)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Contacts</p>
                <p className="text-lg font-medium">{data.usage.contacts.toLocaleString("en")} of {count(data.limits.contacts)}</p>
              </div>
            </div>

            {data.plan !== "internal" && (
              <div className="space-y-3">
                {!data.configured && <p className="text-sm text-muted-foreground">Online billing is not switched on for this CRM yet.</p>}
                {currencies.length > 1 && (
                  <label className="flex items-center gap-2 text-sm">
                    Pay in
                    <select className="h-8 rounded-md border bg-background px-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option value="">Automatic</option>
                      {currencies.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap gap-3">
                  {data.plans.map((p) => (
                    <div key={p.key} className="min-w-48 rounded-md border p-3 text-sm">
                      <p className="font-medium">{p.label}</p>
                      <p className="text-muted-foreground">{count(p.limits.users)} users, {count(p.limits.contacts)} contacts</p>
                      {p.prices.length > 0 && (
                        <p>
                          {money((p.prices.find((x) => x.currency === currency) ?? p.prices[0]).amount, (p.prices.find((x) => x.currency === currency) ?? p.prices[0]).currency)} / month
                          {p.plusTax && <span className="text-muted-foreground"> plus tax where it applies</span>}
                        </p>
                      )}
                      <Button className="mt-2" size="sm" variant={data.plan === p.key && data.writable && data.status === "ACTIVE" ? "outline" : "default"} disabled={!data.configured || !p.available || go.isPending || (data.hasSubscription && data.status !== "CANCELED")} onClick={() => go.mutate({ path: "/api/billing/checkout", body: { plan: p.key, ...(currency && p.prices.some((x) => x.currency === currency) && { currency }) } })}>
                        {data.plan === p.key && data.status === "ACTIVE" ? "Current plan" : `Choose ${p.label}`}
                      </Button>
                    </div>
                  ))}
                </div>
                {data.hasSubscription && (
                  <Button variant="outline" disabled={go.isPending} onClick={() => go.mutate({ path: "/api/billing/portal" })}>
                    Manage subscription, card or cancel
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
