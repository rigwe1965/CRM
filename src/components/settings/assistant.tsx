"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";
import type { AssistantStatus } from "@/lib/client/types";
import { cn } from "@/lib/utils";

const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

/** Admin: Ivy, the AI assistant. The business's own Anthropic key (write-only), a monthly spending limit, and an on/off switch. */
export function AssistantCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["assistant"],
    queryFn: async () => (await request<{ data: AssistantStatus }>("GET", "/api/admin/assistant")).data,
  });
  const done = (message: string) => () => {
    toast.success(message);
    return qc.invalidateQueries({ queryKey: ["assistant"] });
  };
  const saveKey = useMutation({
    mutationFn: (apiKey: string) => request("PUT", "/api/admin/integrations/anthropic", { apiKey }),
    onSuccess: done("Key saved"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeKey = useMutation({
    mutationFn: () => request("DELETE", "/api/admin/integrations/anthropic"),
    onSuccess: done("Key removed"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveSettings = useMutation({
    mutationFn: (body: { enabled: boolean; monthlyCeilingUsd: number | null; proposalsEnabled?: boolean; paymentProposalsEnabled?: boolean }) => request("PUT", "/api/admin/assistant", body),
    onSuccess: done("Saved"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [apiKey, setApiKey] = useState("");
  const [ceiling, setCeiling] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message={error?.message} onRetry={() => refetch()} />;

  const ceilingText = ceiling ?? (data.monthlyCeilingUsd === null ? "" : String(data.monthlyCeilingUsd));
  const parsed = ceilingText.trim() === "" ? null : Number(ceilingText);
  const canSwitchOn = data.keyConfigured && data.monthlyCeilingUsd !== null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ivy, your AI assistant</CardTitle>
          <CardDescription>
            Ivy answers questions about your contacts, deals, payments and stock. It uses your own Anthropic account, so the cost goes on your Anthropic bill, and it only ever sees what the person asking
            can see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={data.keyConfigured ? "default" : "secondary"}>{data.keyConfigured ? "Key saved" : "No key yet"}</Badge>
            <Badge variant={data.enabled ? "default" : "secondary"}>{data.enabled ? "Ivy is on" : "Ivy is off"}</Badge>
            {data.keySource === "env" && <span className="text-xs text-muted-foreground">key comes from the server settings (.env)</span>}
          </div>

          <form
            className="grid max-w-xl gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveKey.mutate(apiKey, { onSuccess: () => setApiKey("") });
            }}
          >
            <FormField label="Anthropic API key" hint="Starts with sk-ant-. Create a standard key in the Anthropic console. We check it with Anthropic when you save, and never show it again.">
              <PasswordInput autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={saveKey.isPending}>
                {saveKey.isPending ? "Checking…" : data.keyConfigured ? "Replace key" : "Save key"}
              </Button>
              {data.keySource === "settings" && (
                <Button type="button" variant="outline" disabled={removeKey.isPending} onClick={() => removeKey.mutate()}>
                  Remove key
                </Button>
              )}
            </div>
          </form>

          <form
            className="grid max-w-xl gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed !== null && !(parsed > 0)) return void toast.error("Enter an amount above $0");
              saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: parsed });
            }}
          >
            <FormField
              label="Monthly spending limit (US dollars)"
              hint="Ivy stops for the month when its estimated spend reaches this, and starts again on the 1st (UTC). It is an estimate from token counts; your Anthropic invoice is the record."
            >
              <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={ceilingText} onChange={(e) => setCeiling(e.target.value)} placeholder="For example 20" />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={saveSettings.isPending}>
                Save limit
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <Button
              type="button"
              variant={data.enabled ? "outline" : "default"}
              disabled={saveSettings.isPending || (!data.enabled && !canSwitchOn)}
              onClick={() => saveSettings.mutate({ enabled: !data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd })}
            >
              {data.enabled ? "Switch Ivy off" : "Switch Ivy on"}
            </Button>
            {!data.enabled && !canSwitchOn && <p className="text-sm text-muted-foreground">Save your key and a monthly limit first.</p>}
          </div>

          <div className="max-w-xl space-y-2 border-t pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">Proposed actions</h3>
              <Badge variant={data.proposalsEnabled ? "default" : "secondary"}>{data.proposalsEnabled ? "Allowed" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When allowed, Ivy can suggest creating or changing a task, logging a note, moving a deal to another stage, or drafting a message. Each suggestion appears as a card, and nothing happens until the person asking presses Approve.
              Ivy never sends anything to a customer.
            </p>
            <Button
              type="button"
              variant={data.proposalsEnabled ? "outline" : "default"}
              disabled={saveSettings.isPending}
              onClick={() => saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, proposalsEnabled: !data.proposalsEnabled })}
            >
              {data.proposalsEnabled ? "Stop allowing proposed actions" : "Allow proposed actions"}
            </Button>
          </div>

          <div className="max-w-xl space-y-2 border-t pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">Payment proposals</h3>
              <Badge variant={data.paymentProposalsEnabled ? "default" : "secondary"}>{data.paymentProposalsEnabled ? "Allowed" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When allowed, Ivy can suggest recording a payment you tell her you received. It appears as a card showing the customer, the deal, the amount and the balance before and after, and nothing is recorded until the person presses
              Record and confirms. Ivy can also suggest creating contacts and deals once proposed actions are allowed.
            </p>
            <Button
              type="button"
              variant={data.paymentProposalsEnabled ? "outline" : "default"}
              disabled={saveSettings.isPending || !data.proposalsEnabled}
              onClick={() => saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, paymentProposalsEnabled: !data.paymentProposalsEnabled })}
            >
              {data.paymentProposalsEnabled ? "Stop allowing payment proposals" : "Allow payment proposals"}
            </Button>
            {!data.proposalsEnabled && <p className="text-sm text-muted-foreground">Allow proposed actions first.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This month</CardTitle>
          <CardDescription>Estimated from the token counts Anthropic reports. Resets on {data.resetsOn}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.ceilingUsd === null ? (
            <p className="text-sm text-muted-foreground">
              {dollars(data.spentUsd)} spent so far. Set a monthly limit above to see how much of it is used.
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{dollars(data.spentUsd)}</span>
                <span className="text-muted-foreground"> of {dollars(data.ceilingUsd)} ({data.percent}%)</span>
              </p>
              <div className="h-2 w-full max-w-xl rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, data.percent ?? 0)} aria-label="Share of the monthly limit used">
                <div
                  className={cn("h-2 rounded", data.level === "reached" ? "bg-destructive" : data.level === "warn" ? "bg-amber-500" : "bg-primary")}
                  style={{ width: `${Math.min(100, data.percent ?? 0)}%` }}
                />
              </div>
              {data.level === "warn" && <p className="text-sm text-amber-600">You have used over 80% of this month&apos;s limit.</p>}
              {data.level === "reached" && <p className="text-sm text-destructive">The limit is reached, so Ivy is paused until {data.resetsOn}. Raise the limit above to resume sooner.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What Ivy shares and keeps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>The questions people ask Ivy, and the records Ivy looks up to answer them (customer names, deals, payments), are sent to Anthropic using your key.</p>
          <p>Conversations are kept for {data.retentionDays} days and then deleted. People can delete their own conversations sooner.</p>
          <p>When proposed actions are allowed, what Ivy suggests (the task, note or message text, and the names it refers to) is saved with the conversation and deleted with it. Approved actions are kept as ordinary records and in the audit log.</p>
          <p>Ivy works as the person asking: sales and support users get answers from their own records only, admins from the whole business.</p>
        </CardContent>
      </Card>
    </div>
  );
}
