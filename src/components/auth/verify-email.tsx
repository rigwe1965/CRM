"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, sendJson } from "./form-ui";

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void sendJson("/api/signup/verify", "POST", { token }).then((res) => {
      if (!cancelled) setState(res.ok ? "done" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "working") return <p className="text-sm text-muted-foreground">Confirming your email…</p>;
  if (state === "done") {
    return (
      <div className="space-y-4">
        <Alert variant="success">Your email is confirmed. Sign in to start your free trial.</Alert>
        <Link href="/sign-in" className="text-sm text-primary hover:underline">Go to sign in</Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Alert variant="error">This confirmation link is invalid or has expired.</Alert>
      <Link href="/sign-up" className="text-sm text-primary hover:underline">Sign up again</Link>
    </div>
  );
}
