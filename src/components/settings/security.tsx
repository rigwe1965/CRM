"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/page";
import { useFormState } from "@/components/forms/form-kit";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";

type Setup = { secret: string; qr: string };

/** Turn two-step verification (authenticator app) on or off for the signed-in user. */
export function MfaCard() {
  const qc = useQueryClient();
  const form = useFormState();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await request<{ user: { mfaEnabled: boolean } }>("GET", "/api/me")).user,
  });
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });

  async function start() {
    setBusy(true);
    try {
      const r = await request<{ secret: string; otpauthUrl: string }>("POST", "/api/me/mfa/setup");
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 192 }) });
      setCode("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    setBusy(true);
    const ok = await form.run(async () => {
      const r = await request<{ recoveryCodes: string[] }>("POST", "/api/me/mfa/enable", { code });
      setRecovery(r.recoveryCodes);
    });
    setBusy(false);
    if (ok) {
      setSetup(null);
      setCode("");
      toast.success("Two-step verification is on");
      await refresh();
    }
  }

  async function disable() {
    setBusy(true);
    const ok = await form.run(() => request("POST", "/api/me/mfa/disable", { password, code }));
    setBusy(false);
    if (ok) {
      setPassword("");
      setCode("");
      toast.success("Two-step verification is off");
      await refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Two-step verification</CardTitle>
          {me && <Badge variant={me.mfaEnabled ? "default" : "secondary"}>{me.mfaEnabled ? "On" : "Off"}</Badge>}
        </div>
        <CardDescription>
          Asks for a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password) every time you sign in, so a stolen password is not enough.
          Magic-link sign-in is switched off for your account while this is on.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-md space-y-4">
        {form.formError && <p role="alert" className="text-sm text-destructive">{form.formError}</p>}

        {recovery && (
          <div role="status" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Save these recovery codes now. They are shown only once.</p>
            <p>If you lose your phone, each code signs you in one time.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
              {recovery.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(recovery.join("\n")).then(() => toast.success("Codes copied"))}>
                Copy codes
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRecovery(null)}>
                I saved them
              </Button>
            </div>
          </div>
        )}

        {!me ? null : me.mfaEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">To turn it off, enter your password and a current code (or a recovery code).</p>
            <FormField label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <FormField label="Code" error={form.err("code")}>
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </FormField>
            <Button type="button" variant="outline" disabled={busy || !password || !code} onClick={() => void disable()}>
              Turn off
            </Button>
          </div>
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-sm">1. Scan this QR code with your authenticator app.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded-md border bg-white" />
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key instead: <span className="break-all font-mono">{setup.secret}</span>
            </p>
            <p className="text-sm">2. Enter the 6-digit code it shows.</p>
            <FormField label="Code" error={form.err("code")}>
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </FormField>
            <div className="flex gap-2">
              <Button type="button" disabled={busy || code.trim().length < 6} onClick={() => void enable()}>
                Turn on
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setSetup(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" disabled={busy} onClick={() => void start()}>
            Set up
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Ends every session of the signed-in user, on every device (this one too). */
export function SessionsCard() {
  const out = useMutation({
    mutationFn: () => request("DELETE", "/api/me/sessions"),
    onSuccess: async () => {
      toast.success("Signed out everywhere");
      await signOut({ callbackUrl: "/sign-in" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Lost a laptop or signed in on a shared computer? This signs you out on every device, including this one.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" disabled={out.isPending} onClick={() => out.mutate()}>
          {out.isPending ? "Signing out…" : "Sign out everywhere"}
        </Button>
      </CardContent>
    </Card>
  );
}
