"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";

type View = {
  stripe: { configured: boolean; source: "settings" | "env" | null; webhookUrl: string };
  whatsapp: { configured: boolean; source: "settings" | "env" | null; phoneNumberId: string | null; businessAccountId: string | null; webhookUrl: string };
  leadForm: { configured: boolean; source: "settings" | "env" | null; origins: string[]; formUrl: string };
};

const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));

function Status({ configured, source }: { configured: boolean; source: "settings" | "env" | null }) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant={configured ? "default" : "secondary"}>{configured ? "Connected" : "Not set up"}</Badge>
      {source === "env" && <span className="text-xs text-muted-foreground">from the server settings (.env)</span>}
    </div>
  );
}

function Address({ label, url }: { label: string; url: string }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="break-all rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <Button type="button" size="icon" variant="ghost" aria-label="Copy" onClick={() => copy(url)}>
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Admin: the business's own Stripe, WhatsApp and website-form settings. Secrets are write-only: they are never shown again. */
export function IntegrationsCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await request<{ data: View }>("GET", "/api/admin/integrations")).data,
  });
  const save = useMutation({
    mutationFn: ({ kind, body }: { kind: string; body: unknown }) => request("PUT", `/api/admin/integrations/${kind}`, body),
    onSuccess: () => {
      toast.success("Saved");
      return Promise.all([qc.invalidateQueries({ queryKey: ["integrations"] }), qc.invalidateQueries({ queryKey: ["lead-form"] })]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (kind: string) => request("DELETE", `/api/admin/integrations/${kind}`),
    onSuccess: () => {
      toast.success("Removed");
      return Promise.all([qc.invalidateQueries({ queryKey: ["integrations"] }), qc.invalidateQueries({ queryKey: ["lead-form"] })]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [stripe, setStripe] = useState({ secretKey: "", webhookSecret: "" });
  const [wa, setWa] = useState({ accessToken: "", phoneNumberId: "", businessAccountId: "", appSecret: "", verifyToken: "" });
  const [origins, setOrigins] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message={error?.message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Online payments (Stripe)</CardTitle>
          <CardDescription>Your own Stripe account, so customers pay you directly. Create a restricted or secret key, then add the webhook address below in Stripe for the events checkout.session.completed and checkout.session.async_payment_succeeded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Status {...data.stripe} />
          <Address label="Webhook address for Stripe" url={data.stripe.webhookUrl} />
          <form
            className="grid max-w-xl gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ kind: "stripe", body: stripe }, { onSuccess: () => setStripe({ secretKey: "", webhookSecret: "" }) });
            }}
          >
            <FormField label="Secret key" hint="Starts with sk_ or rk_. Not shown again after saving.">
              <PasswordInput autoComplete="off" value={stripe.secretKey} onChange={(e) => setStripe({ ...stripe, secretKey: e.target.value })} required />
            </FormField>
            <FormField label="Webhook signing secret" hint="Starts with whsec_.">
              <PasswordInput autoComplete="off" value={stripe.webhookSecret} onChange={(e) => setStripe({ ...stripe, webhookSecret: e.target.value })} required />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>{data.stripe.configured ? "Replace keys" : "Save keys"}</Button>
              {data.stripe.source === "settings" && <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate("stripe")}>Remove</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>Your own WhatsApp Business number (Meta Cloud API). Set the callback address below and your verify token in Meta, and subscribe to the messages field.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Status {...data.whatsapp} />
          {data.whatsapp.phoneNumberId && <p className="text-sm text-muted-foreground">Phone number ID: {data.whatsapp.phoneNumberId}</p>}
          {data.whatsapp.businessAccountId && <p className="text-sm text-muted-foreground">Business Account ID: {data.whatsapp.businessAccountId}</p>}
          <Address label="Callback address for Meta" url={data.whatsapp.webhookUrl} />
          <form
            className="grid max-w-xl gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { kind: "whatsapp", body: { ...wa, businessAccountId: wa.businessAccountId.trim() || undefined } },
                { onSuccess: () => setWa({ accessToken: "", phoneNumberId: "", businessAccountId: "", appSecret: "", verifyToken: "" }) },
              );
            }}
          >
            <FormField label="Access token" hint="A permanent system-user token.">
              <PasswordInput autoComplete="off" value={wa.accessToken} onChange={(e) => setWa({ ...wa, accessToken: e.target.value })} required />
            </FormField>
            <FormField label="Phone number ID" hint="The number's ID in Meta (digits), not the phone number itself.">
              <Input value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} required />
            </FormField>
            <FormField label="WhatsApp Business Account ID (optional)" hint="Needed only to copy your message templates from Meta (Settings → Templates). Find it in WhatsApp Manager; digits only.">
              <Input value={wa.businessAccountId} onChange={(e) => setWa({ ...wa, businessAccountId: e.target.value })} />
            </FormField>
            <FormField label="App secret" hint="Used to check that messages really come from Meta.">
              <PasswordInput autoComplete="off" value={wa.appSecret} onChange={(e) => setWa({ ...wa, appSecret: e.target.value })} required />
            </FormField>
            <FormField label="Verify token" hint="You invent this (16+ characters) and enter the same in Meta.">
              <PasswordInput autoComplete="off" value={wa.verifyToken} onChange={(e) => setWa({ ...wa, verifyToken: e.target.value })} required minLength={16} />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>{data.whatsapp.configured ? "Replace settings" : "Save settings"}</Button>
              {data.whatsapp.source === "settings" && <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate("whatsapp")}>Remove</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Website enquiry form: allowed websites</CardTitle>
          <CardDescription>Only these websites may send enquiries from a visitor&apos;s browser. Who receives them, and the code to paste, are under Lead form.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Status {...data.leadForm} />
          <Address label="Form address" url={data.leadForm.formUrl} />
          <form
            className="grid max-w-xl gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const list = (origins ?? data.leadForm.origins.join("\n")).split(/[\s,]+/).filter(Boolean);
              save.mutate({ kind: "lead-form", body: { origins: list } }, { onSuccess: () => setOrigins(null) });
            }}
          >
            <FormField label="Websites" hint="One per line, like https://www.example.com (no path).">
              <Textarea rows={3} value={origins ?? data.leadForm.origins.join("\n")} onChange={(e) => setOrigins(e.target.value)} />
            </FormField>
            <div>
              <Button type="submit" disabled={save.isPending || origins === null}>Save websites</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
