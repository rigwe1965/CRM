"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/components/providers";
import { useDismissOnboarding, useOnboarding } from "@/lib/client/hooks";

/** The getting-started checklist at the top of an admin's dashboard. Gone once everything is done or the admin hides it. */
export function OnboardingChecklist() {
  const isAdmin = useCurrentUser().role === "ADMIN";
  const { data } = useOnboarding(isAdmin);
  const dismiss = useDismissOnboarding();
  if (!isAdmin || !data || data.dismissed || data.allDone) return null;
  const done = data.steps.filter((s) => s.done).length;

  return (
    <Card className="mb-6" aria-label="Getting started">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          Getting started <span className="ml-2 text-sm font-normal text-muted-foreground">{done} of {data.steps.length} done</span>
        </CardTitle>
        <Button variant="ghost" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(true)}>
          Hide
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.steps.map((s) => (
            <li key={s.key} className="flex items-center gap-3 py-2.5">
              {s.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-label="To do" />}
              <div className="min-w-0 flex-1">
                <p className={s.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{s.label}</p>
                {!s.done && <p className="text-xs text-muted-foreground">{s.hint}</p>}
              </div>
              {!s.done && (
                <Button asChild size="sm" variant="outline">
                  <Link href={s.href}>Open</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
