"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentUser } from "@/components/providers";
import { ErrorState, FormField, PageHeader } from "@/components/common/page";
import { useFormState } from "@/components/forms/form-kit";
import { request } from "@/lib/client/api";
import { shortDate } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/hooks";
import type { Role, TeamUser } from "@/lib/client/types";
import { useRouter } from "next/navigation";

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
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const [mismatch, setMismatch] = useState(false);

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
              request("POST", "/api/me/password", { currentPassword: v.current || undefined, newPassword: v.next }),
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
          <FormField label="Current password" error={form.err("currentPassword")} hint="Leave blank if you signed up with a magic link and have no password yet.">
            <Input type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} aria-invalid={!!form.err("currentPassword")} />
          </FormField>
          <FormField label="New password" error={form.err("newPassword")} hint="At least 8 characters, with a letter and a number.">
            <Input type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} aria-invalid={!!form.err("newPassword")} />
          </FormField>
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

function TeamCard() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["team"],
    queryFn: async () => (await request<{ users: TeamUser[] }>("GET", "/api/admin/users")).users,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; isActive?: boolean }) => request("PATCH", `/api/admin/users/${id}`, body),
    onSuccess: () => {
      toast.success("User updated");
      return qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Admins can change roles and deactivate accounts. Deactivated users are signed out immediately.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
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
                <TableHead className="w-28" />
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
                    <TableCell className="text-right">
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
        </TabsList>
        <TabsContent value="profile">
          <ProfileCard />
        </TabsContent>
        <TabsContent value="security">
          <PasswordCard />
        </TabsContent>
        {user.role === "ADMIN" && (
          <TabsContent value="team">
            <TeamCard />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
