"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { downloadFile } from "@/lib/client/download";
import { errorMessage } from "@/lib/client/hooks";

const DELETED_AREAS = [
  { value: "contacts", label: "Contacts" },
  { value: "organizations", label: "Companies" },
  { value: "deals", label: "Deals" },
  { value: "deal-items", label: "Deal items" },
  { value: "payments", label: "Payments" },
  { value: "instalments", label: "Instalments" },
];

/**
 * Admin-only exports that carry the most data. Each asks for a fresh authenticator (or recovery) code
 * when two-step verification is on, because a stolen session alone should not be able to take the
 * whole customer list. A code works once, so the field is cleared after every attempt.
 */
export function DataExportCard() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await request<{ user: { mfaEnabled: boolean } }>("GET", "/api/me")).user,
  });
  const [code, setCode] = useState("");
  const [area, setArea] = useState("contacts");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsCode = !!me?.mfaEnabled;

  async function run(key: string, path: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const name = await downloadFile("POST", path, { ...body, code: code.trim() || undefined });
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCode("");
      setBusy(null);
    }
  }

  const disabled = busy !== null || (needsCode && !code.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data export</CardTitle>
        <CardDescription>
          Copies of your data to keep offline. These contain customer personal data and payment records: store them encrypted and delete copies you no longer need. Every export is recorded in the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-xl space-y-6">
        {needsCode ? (
          <FormField label="Authenticator code" hint="The 6-digit code from your app, or a recovery code. It works once, so enter a fresh one for each download.">
            <Input autoComplete="one-time-code" inputMode="text" value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
        ) : (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Two-step verification is off for your account, so these downloads ask for nothing extra. Turn it on under Settings → Security to require a code.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Everything (zip of CSV files)</h3>
          <p className="text-sm text-muted-foreground">
            One file per area, including deleted records and the audit log. It is a copy for reading and keeping, not a way to restore the CRM: use a database backup for that.
          </p>
          <Button disabled={disabled} onClick={() => run("full", "/api/export/full", {})}>
            <Download /> {busy === "full" ? "Preparing…" : "Download everything"}
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Audit log (CSV)</h3>
          <p className="text-sm text-muted-foreground">Who did what and when, with snapshots of deleted records. Up to 50,000 entries per file.</p>
          <Button variant="outline" disabled={disabled} onClick={() => run("audit", "/api/export/audit-log", {})}>
            <Download /> {busy === "audit" ? "Preparing…" : "Download audit log"}
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Deleted records (CSV)</h3>
          <p className="text-sm text-muted-foreground">Records that were deleted but are still kept, for one area, with a deletedAt column.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger className="w-44" aria-label="Area"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DELETED_AREAS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={disabled} onClick={() => run("deleted", `/api/export/${area}`, { includeDeleted: true })}>
              <Download /> {busy === "deleted" ? "Preparing…" : "Download with deleted"}
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
