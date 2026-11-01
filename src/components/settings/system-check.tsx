"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/page";
import { request } from "@/lib/client/api";
import type { Check, CheckStatus } from "@/lib/system-check";

const ICON: Record<CheckStatus, { Icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-emerald-600", label: "OK" },
  warn: { Icon: CircleAlert, cls: "text-amber-600", label: "Needs a look" },
  fail: { Icon: XCircle, cls: "text-red-600", label: "Problem" },
};

/** Platform owner only: whether this installation is set up the way the runbook says. Read-only. */
export function SystemCheckCard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["system-check"],
    queryFn: () => request<{ checks: Check[] }>("GET", "/api/admin/system-check"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>System check</CardTitle>
        <CardDescription>
          Whether this installation is set up the way the launch runbook says. It shows verdicts only, never keys or addresses. It cannot see your database provider&apos;s backups: test those with the restore drill.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : (
          <ul className="divide-y">
            {data?.checks.map((c) => {
              const { Icon, cls, label } = ICON[c.status];
              return (
                <li key={c.id} className="flex items-start gap-3 py-3">
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cls}`} aria-label={label} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-sm text-muted-foreground">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
