"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { safeRedirect } from "@/lib/rbac";
import { Alert, Field, SubmitButton } from "./form-ui";

const URL_ERRORS: Record<string, string> = {
  Verification: "That sign-in link is invalid or has expired. Request a new one.",
  AccessDenied: "This account is not allowed to sign in.",
};

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeRedirect(params.get("callbackUrl"));
  const urlError = params.get("error");

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [pending, setPending] = useState(false);
  // Set once the password is right and the account has two-step verification.
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError ? (URL_ERRORS[urlError] ?? "Could not sign in. Please try again.") : null,
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    setPending(true);
    setError(null);
    try {
      if (mode === "password") {
        const password = String(form.get("password") ?? "");
        if (!needsCode) {
          const check = await fetch("/api/auth/mfa-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (check.status === 429) {
            setError("Too many attempts. Wait a few minutes and try again.");
            return;
          }
          if (check.ok && ((await check.json()) as { mfa?: boolean }).mfa) {
            setNeedsCode(true);
            return;
          }
        }
        const res = await signIn("credentials", {
          email,
          password,
          code: needsCode ? String(form.get("code") ?? "") : "",
          redirect: false,
        });
        if (!res || res.error) {
          setError(needsCode ? "That code is not right. Try again or use a recovery code." : "Invalid email or password.");
          return;
        }
        router.replace(callbackUrl);
        router.refresh();
      } else {
        const res = await signIn("nodemailer", { email, redirect: false, callbackUrl });
        if (!res || res.error) {
          setError("Could not send a sign-in link. Accounts with two-step verification must sign in with a password.");
          return;
        }
        router.push("/verify-request");
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {params.get("reset") && <Alert variant="success">Password updated. Sign in with your new password.</Alert>}
      {params.get("passwordChanged") && (
        <Alert variant="success">Password changed. Please sign in again.</Alert>
      )}
      {error && <Alert variant="error">{error}</Alert>}

      <Field label="Email" name="email" type="email" autoComplete="email" required disabled={pending} readOnly={needsCode} />
      {mode === "password" && (
        <div className="space-y-1">
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
            readOnly={needsCode}
          />
          {needsCode && (
            <Field
              label="Authentication code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              hint="The 6-digit code from your authenticator app, or a recovery code."
              required
              autoFocus
              disabled={pending}
            />
          )}
          <div className="text-right">
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
      )}

      <SubmitButton pending={pending} pendingText={mode === "password" ? "Signing in…" : "Sending link…"}>
        {mode === "password" ? (needsCode ? "Verify and sign in" : "Sign in") : "Email me a sign-in link"}
      </SubmitButton>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMode(mode === "password" ? "magic" : "password");
          setError(null);
        }}
        className="w-full text-center text-sm text-primary hover:underline disabled:opacity-60"
      >
        {mode === "password" ? "Use a magic link instead" : "Use a password instead"}
      </button>
    </form>
  );
}
