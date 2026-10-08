"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentUser } from "@/components/providers";
import { ConfirmDialog, ErrorState, FormField, PageHeader } from "@/components/common/page";
import { useFormState } from "@/components/forms/form-kit";
import { request } from "@/lib/client/api";
import { shortDate } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/hooks";
import type { Role, TeamUser } from "@/lib/client/types";
import { useRouter } from "next/navigation";
import { AuditLogCard } from "@/components/settings/audit-log";
import { MfaCard, SessionsCard } from "@/components/settings/security";

function ProfileCard() {
  const user = useCurrentUser();
  const router = useRouter();
  const form = useFormState();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name is shown on records you create and tasks you own.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="max-w-md space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            const ok = await form.run(() => request("PATCH", "/api/me", { name }));
            setSaving(false);
            if (ok) {
              toast.success("Profile updated");
              router.refresh();
            }
          }}
        >
          {form.formError && <p role="alert" className="text-sm text-destructive">{form.formError}</p>}
          <FormField label="Email">
            <Input value={user.email} disabled />
          </FormField>
          <FormField label="Name" error={form.err("name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!form.err("name")} />
          </FormField>
          <FormField label="Role">
            <div>
              <Badge variant="default" className="capitalize">{user.role.toLowerCase()}</Badge>
            </div>
          </FormField>
          <Button type="submit" disabled={saving || name.trim() === user.name}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const form = useFormState();
  const [saving, setSaving] = useState(false);
  const [v, setV] = useState({ current: "", next: "", confirm: "", code: "" });
  const [mismatch, setMismatch] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await request<{ user: { mfaEnabled: boolean } }>("GET", "/api/me")).user,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing your password signs you out on every device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="max-w-md space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (v.next !== v.confirm) {
              setMismatch(true);
              return;
            }
            setMismatch(false);
            setSaving(true);
            const ok = await form.run(() =>
              request("POST", "/api/me/password", { currentPassword: v.current || undefined, newPassword: v.next, code: v.code || undefined }),
            );
            if (ok) {
              toast.success("Password changed. Please sign in again.");
              await signOut({ callbackUrl: "/sign-in?passwordChanged=1" });
              return;
            }
            setSaving(false);
          }}
        >
          {form.formError && !form.err("currentPassword") && !form.err("newPassword") && (
            <p role="alert" className="text-sm text-destructive">{form.formError}</p>
          )}
          <FormField label="Current password" error={form.err("currentPassword")} hint="Leave blank if you have no password yet.">
            <Input type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} aria-invalid={!!form.err("currentPassword")} />
          </FormField>
          <FormField label="New password" error={form.err("newPassword")} hint="At least 10 characters, with a letter and a number.">
            <Input type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} aria-invalid={!!form.err("newPassword")} />
          </FormField>
          {me?.mfaEnabled && (
            <FormField label="Authenticator code" error={form.err("code")} hint="The 6-digit code from your app, or a recovery code.">
              <Input autoComplete="one-time-code" inputMode="text" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} aria-invalid={!!form.err("code")} />
            </FormField>
          )}
          <FormField label="Confirm new password" error={mismatch ? "Passwords do not match" : undefined}>
            <Input type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} aria-invalid={mismatch} />
          </FormField>
          <Button type="submit" disabled={saving || !v.next}>
            {saving ? "Updating…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Edit a user's name and role (email is their login and can't be changed here). */
function EditUserDialog({ user, onClose, onSave, pending }: { user: TeamUser | null; onClose: () => void; onSave: (body: { id: string; name: string; role: Role }) => void; pending: boolean }) {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const act = useMutation({
    mutationFn: ({ path }: { path: "revoke-sessions" | "mfa-reset" }) => request("POST", `/api/admin/users/${user?.id}/${path}`),
    onSuccess: (_r, { path }) => {
      toast.success(path === "mfa-reset" ? "Two-step verification reset. They are signed out." : "Signed out everywhere");
      setResetting(false);
      return qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("SALES");
  const [shown, setShown] = useState<string | null>(null);
  if (user && shown !== user.id) {
    setShown(user.id);
    setName(user.name);
    setRole(user.role);
  }
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && (setShown(null), onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user?.email}. The email is the login, so it cannot be changed.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (user) onSave({ id: user.id, name: name.trim(), role });
          }}
        >
          <FormField label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>
          <FormField label="Role">
            <Select value={role} onValueChange={(r) => setRole(r as Role)}>
              <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="SALES">Sales</SelectItem>
                <SelectItem value="SUPPORT">Support</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {user && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button type="button" variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ path: "revoke-sessions" })}>
                Sign out everywhere
              </Button>
              {user.mfaEnabled && (
                <Button type="button" variant="outline" size="sm" disabled={act.isPending} onClick={() => setResetting(true)}>
                  Reset two-step verification
                </Button>
              )}
            </div>
          )}
          <ConfirmDialog
            open={resetting}
            onOpenChange={setResetting}
            title="Reset two-step verification?"
            description={`${user?.name ?? "This user"} will be signed out everywhere and can sign in with just their password until they set it up again. Only do this after confirming it's really them (for example, they lost their phone).`}
            pending={act.isPending}
            onConfirm={() => act.mutate({ path: "mfa-reset" })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => (setShown(null), onClose())} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || !name.trim()}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamCard() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["team"],
    queryFn: async () => (await request<{ users: TeamUser[] }>("GET", "/api/admin/users")).users,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; role?: Role; isActive?: boolean }) => request("PATCH", `/api/admin/users/${id}`, body),
    onSuccess: () => {
      toast.success("User updated");
      setEditing(null);
      return qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [editing, setEditing] = useState<TeamUser | null>(null);
  // Set when no email provider is configured (development): the set-password link to pass on.
  const [devLink, setDevLink] = useState<{ email: string; url: string } | null>(null);
  const resend = useMutation({
    mutationFn: (u: TeamUser) => request<{ emailed: boolean; devLink?: string }>("POST", `/api/admin/users/${u.id}/invite`).then((r) => ({ ...r, email: u.email })),
    onSuccess: (r) => {
      if (r.devLink) setDevLink({ email: r.email, url: r.devLink });
      else if (r.emailed) toast.success("Invitation sent");
      else toast.warning("The email could not be sent. Check the email settings.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [invite, setInvite] = useState<{ name: string; email: string; role: Role }>({ name: "", email: "", role: "SALES" });
  const create = useMutation({
    mutationFn: (body: typeof invite) => request<{ emailed: boolean; devLink?: string }>("POST", "/api/admin/users", body),
    onSuccess: (res, body) => {
      if (res.devLink) {
        setDevLink({ email: body.email, url: res.devLink });
        toast.success("User created");
      } else if (res.emailed) toast.success("Invitation sent");
      else toast.warning("User created, but the invitation email could not be sent. Use “Send invite” on their row to try again.");
      setInvite({ name: "", email: "", role: "SALES" });
      return qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Accounts are created by admins only. Admins can also change roles and deactivate accounts; deactivated users are signed out immediately.</CardDescription>
        <form
          className="grid gap-3 pt-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(invite);
          }}
        >
          <FormField label="Name">
            <Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} required />
          </FormField>
          <FormField label="Email">
            <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required />
          </FormField>
          <FormField label="Role">
            <Select value={invite.role} onValueChange={(role) => setInvite({ ...invite, role: role as Role })}>
              <SelectTrigger aria-label="Role for new user"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="SALES">Sales</SelectItem>
                <SelectItem value="SUPPORT">Support</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Inviting…" : "Invite user"}</Button>
        </form>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {devLink && (
          <div role="status" className="mx-5 mb-3 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>
              No email provider is set up, so nothing was emailed to <strong>{devLink.email}</strong>. Open this link to set their password (valid 7 days):
            </p>
            <p className="break-all rounded bg-background p-2 font-mono text-xs">{devLink.url}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(devLink.url).then(() => toast.success("Link copied"))}>Copy link</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDevLink(null)}>Dismiss</Button>
            </div>
          </div>
        )}
        <EditUserDialog user={editing} onClose={() => setEditing(null)} onSave={(b) => update.mutate(b)} pending={update.isPending} />
        {isLoading ? (
          <Skeleton className="mx-5 h-32" />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((u) => {
                const self = u.id === me.id;
                return (
                  <TableRow key={u.id} className={u.isActive ? "" : "opacity-60"}>
                    <TableCell>
                      <p className="font-medium">
                        {u.name} {self && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell>
                      <Select value={u.role} disabled={self || update.isPending} onValueChange={(role) => update.mutate({ id: u.id, role: role as Role })}>
                        <SelectTrigger className="w-32" aria-label={`Role for ${u.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                          <SelectItem value="SALES">Sales</SelectItem>
                          <SelectItem value="SUPPORT">Support</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{shortDate(u.createdAt)}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(u)}>Edit</Button>
                      {u.isActive && !u.hasPassword && (
                        <Button variant="outline" size="sm" disabled={resend.isPending} onClick={() => resend.mutate(u)}>Send invite</Button>
                      )}
                      {!self && (
                        <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}>
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader title="Settings" description="Manage your account and, for admins, your team." />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          {user.role === "ADMIN" && <TabsTrigger value="team">Team</TabsTrigger>}
          {user.role === "ADMIN" && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile">
          <ProfileCard />
        </TabsContent>
        <TabsContent value="security">
          <div className="space-y-6">
            <PasswordCard />
            <MfaCard />
            <SessionsCard />
          </div>
        </TabsContent>
        {user.role === "ADMIN" && (
          <TabsContent value="team">
            <TeamCard />
          </TabsContent>
        )}
        {user.role === "ADMIN" && (
          <TabsContent value="audit">
            <AuditLogCard />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
