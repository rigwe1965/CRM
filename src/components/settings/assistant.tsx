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

/** Admin: AI, the AI assistant. The business's own Anthropic key (write-only), a monthly spending limit, and an on/off switch. */
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
    mutationFn: (body: { enabled: boolean; monthlyCeilingUsd: number | null; model?: string; proposalsEnabled?: boolean; paymentProposalsEnabled?: boolean; inboxEnabled?: boolean; triageEnabled?: boolean; triageDailyCap?: number; documentsEnabled?: boolean; documentsDailyCap?: number }) => request("PUT", "/api/admin/assistant", body),
    onSuccess: done("Saved"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [apiKey, setApiKey] = useState("");
  const [ceiling, setCeiling] = useState<string | null>(null);
  const [triageCap, setTriageCap] = useState<string | null>(null);
  const [docCap, setDocCap] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message={error?.message} onRetry={() => refetch()} />;

  const ceilingText = ceiling ?? (data.monthlyCeilingUsd === null ? "" : String(data.monthlyCeilingUsd));
  const parsed = ceilingText.trim() === "" ? null : Number(ceilingText);
  const canSwitchOn = data.keyConfigured && data.monthlyCeilingUsd !== null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI assistant</CardTitle>
          <CardDescription>
            AI answers questions about your contacts, deals, payments and stock. It uses your own Anthropic account, so the cost goes on your Anthropic bill, and it only ever sees what the person asking
            can see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={data.keyConfigured ? "default" : "secondary"}>{data.keyConfigured ? "Key saved" : "No key yet"}</Badge>
            <Badge variant={data.enabled ? "default" : "secondary"}>{data.enabled ? "AI is on" : "AI is off"}</Badge>
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
              hint="AI stops for the month when its estimated spend reaches this, and starts again on the 1st (UTC). It is an estimate from token counts; your Anthropic invoice is the record."
            >
              <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={ceilingText} onChange={(e) => setCeiling(e.target.value)} placeholder="For example 20" />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={saveSettings.isPending}>
                Save limit
              </Button>
            </div>
          </form>

          <fieldset className="max-w-xl space-y-2" disabled={saveSettings.isPending || !data.keyConfigured}>
            <legend className="text-sm font-medium">Which Claude model AI uses</legend>
            <p className="text-sm text-muted-foreground">
              You can change this at any time; it applies to the next question. Your key is checked against the model before the change is saved, so AI never stops working because of a choice.
              Prices differ, and the monthly limit above counts each model at its own price.
            </p>
            <div className="grid gap-2">
              {data.modelOptions.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary">
                  <input
                    type="radio"
                    name="assistant-model"
                    className="mt-1"
                    checked={data.model === m.id}
                    onChange={() => saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, model: m.id })}
                  />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-muted-foreground">{m.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
            {!data.keyConfigured && <p className="text-sm text-muted-foreground">Save your Anthropic key first.</p>}
          </fieldset>

          <div className="space-y-2">
            <Button
              type="button"
              variant={data.enabled ? "outline" : "default"}
              disabled={saveSettings.isPending || (!data.enabled && !canSwitchOn)}
              onClick={() => saveSettings.mutate({ enabled: !data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd })}
            >
              {data.enabled ? "Switch AI off" : "Switch AI on"}
            </Button>
            {!data.enabled && !canSwitchOn && <p className="text-sm text-muted-foreground">Save your key and a monthly limit first.</p>}
          </div>

          <div className="max-w-xl space-y-2 border-t pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">Proposed actions</h3>
              <Badge variant={data.proposalsEnabled ? "default" : "secondary"}>{data.proposalsEnabled ? "Allowed" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When allowed, AI can suggest creating or changing a task, logging a note, moving a deal to another stage, or drafting a message. Each suggestion appears as a card, and nothing happens until the person asking presses Approve.
              AI never sends anything to a customer.
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
              When allowed, AI can suggest recording a payment you tell it you received. It appears as a card showing the customer, the deal, the amount and the balance before and after, and nothing is recorded until the person presses
              Record and confirms. AI can also suggest creating contacts and deals once proposed actions are allowed.
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

          <div className="max-w-xl space-y-2 border-t pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">Daily suggestions</h3>
              <Badge variant={data.inboxEnabled ? "default" : "secondary"}>{data.inboxEnabled ? "Allowed" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When allowed, the first time each person uses the app in a day, AI looks through their own records for things that need attention (an overdue instalment nobody has followed up, a deal gone quiet, a won deal with no payment plan) and
              puts suggestions in their Suggested list, each with a reason. They approve, edit or decline them like any other suggestion; nothing is sent to a customer. It costs a few cents per person per day, counted in your monthly limit, and each person can
              turn it off for themselves.
            </p>
            <Button
              type="button"
              variant={data.inboxEnabled ? "outline" : "default"}
              disabled={saveSettings.isPending || !data.proposalsEnabled}
              onClick={() => saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, inboxEnabled: !data.inboxEnabled })}
            >
              {data.inboxEnabled ? "Stop daily suggestions" : "Allow daily suggestions"}
            </Button>
            {!data.proposalsEnabled && <p className="text-sm text-muted-foreground">Allow proposed actions first.</p>}
          </div>

          <div className="max-w-xl space-y-2 border-t pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">WhatsApp message help</h3>
              <Badge variant={data.triageEnabled ? "default" : "secondary"}>{data.triageEnabled ? "Allowed" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When allowed, each time a known customer writes to you on WhatsApp, AI reads that conversation&apos;s last few messages and prepares, for the customer&apos;s owner, a short summary, a draft reply and, if useful, a task or note. The owner
              reads, edits and sends the reply themselves; AI never sends anything and never records a payment. If a customer asks to stop, the owner is offered to mark them as not agreeing to WhatsApp messages. New numbers you have not replied to yet are
              not sent to Anthropic. It costs roughly one to two cents a message, counted in your monthly limit.
            </p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(triageCap ?? data.triageDailyCap);
                if (!Number.isInteger(n) || n < 1 || n > 1000) return void toast.error("Enter a whole number from 1 to 1000");
                saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, triageDailyCap: n });
              }}
            >
              <FormField label="Most messages a day" hint="After this many in a day, new messages just get the usual reply task.">
                <Input type="number" inputMode="numeric" min="1" max="1000" step="1" className="w-28" value={triageCap ?? String(data.triageDailyCap)} onChange={(e) => setTriageCap(e.target.value)} />
              </FormField>
              <Button type="submit" variant="outline" disabled={saveSettings.isPending}>Save</Button>
            </form>
            <Button
              type="button"
              variant={data.triageEnabled ? "outline" : "default"}
              disabled={saveSettings.isPending || !data.proposalsEnabled}
              onClick={() => saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, triageEnabled: !data.triageEnabled })}
            >
              {data.triageEnabled ? "Stop WhatsApp message help" : "Allow WhatsApp message help"}
            </Button>
            {!data.proposalsEnabled && <p className="text-sm text-muted-foreground">Allow proposed actions first.</p>}
          </div>

          <div className="max-w-xl space-y-2 border-t pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">Read documents</h3>
              <Badge variant={data.documentsEnabled ? "default" : "secondary"}>{data.documentsEnabled ? "Allowed" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When allowed, the Invoices page gains &quot;Read a PDF or photo&quot;: AI reads a supplier invoice and fills the New invoice form for the person to check and save. It can misread numbers, so it warns when the lines do not add up to the printed total, and
              nothing is saved until the person presses Create. The file is read once and not kept. It costs roughly 2 to 6 cents a document, counted in your monthly limit.
            </p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(docCap ?? data.documentsDailyCap);
                if (!Number.isInteger(n) || n < 1 || n > 500) return void toast.error("Enter a whole number from 1 to 500");
                saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, documentsDailyCap: n });
              }}
            >
              <FormField label="Most documents a day" hint="After this many in a day, people can still import a spreadsheet or type the invoice in.">
                <Input type="number" inputMode="numeric" min="1" max="500" step="1" className="w-28" value={docCap ?? String(data.documentsDailyCap)} onChange={(e) => setDocCap(e.target.value)} />
              </FormField>
              <Button type="submit" variant="outline" disabled={saveSettings.isPending}>Save</Button>
            </form>
            <Button
              type="button"
              variant={data.documentsEnabled ? "outline" : "default"}
              disabled={saveSettings.isPending}
              onClick={() => saveSettings.mutate({ enabled: data.enabled, monthlyCeilingUsd: data.monthlyCeilingUsd, documentsEnabled: !data.documentsEnabled })}
            >
              {data.documentsEnabled ? "Stop reading documents" : "Allow reading documents"}
            </Button>
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
              <p className="text-xs text-muted-foreground">
                Chat {dollars(data.spentByPurposeUsd.chat)}
                {data.inboxEnabled || data.spentByPurposeUsd.inbox > 0 ? <> · Daily suggestions {dollars(data.spentByPurposeUsd.inbox)}</> : null}
                {data.spentByPurposeUsd.triage > 0 ? <> · WhatsApp {dollars(data.spentByPurposeUsd.triage)}</> : null}
                {data.spentByPurposeUsd.documents > 0 ? <> · Documents {dollars(data.spentByPurposeUsd.documents)}</> : null}
              </p>
              {data.level === "warn" && <p className="text-sm text-amber-600">You have used over 80% of this month&apos;s limit.</p>}
              {data.level === "reached" && <p className="text-sm text-destructive">The limit is reached, so AI is paused until {data.resetsOn}. Raise the limit above to resume sooner.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What AI shares and keeps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>The questions people ask AI, and the records AI looks up to answer them (customer names, deals, payments), are sent to Anthropic using your key.</p>
          <p>Conversations are kept for {data.retentionDays} days and then deleted. People can delete their own conversations sooner.</p>
          <p>When proposed actions are allowed, what AI suggests (the task, note or message text, and the names it refers to) is saved with the conversation and deleted with it. Approved actions are kept as ordinary records and in the audit log.</p>
          <p>Daily suggestions use only each person&apos;s own records and send the names, deals and amounts they involve to Anthropic under your key, in one short request a day per person.</p>
          <p>WhatsApp message help sends the customer&apos;s latest few messages in that one conversation, their first name, and their deals, balances and open tasks to Anthropic under your key, once per incoming message, so the customer&apos;s own words leave your system. Only turn it on if your customers expect that. The suggestions it makes quote up to 300 characters of the message, and a short summary of each message is kept; both are deleted after {data.retentionDays} days.</p>
          <p>Reading documents sends the whole file (a PDF or photo, such as a supplier invoice or a screenshot of a customer&apos;s order), including any names, phone numbers or bank details printed on it, to Anthropic under your key, once for each document someone chooses to have read. The CRM does not keep the file or a copy of what was read, other than what the person then saves as an invoice.</p>
          <p>AI works as the person asking: sales and support users get answers from their own records only, admins from the whole business.</p>
        </CardContent>
      </Card>
    </div>
  );
}
