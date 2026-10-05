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
        const res = await signIn("credentials", {
          email,
          password: String(form.get("password") ?? ""),
          redirect: false,
        });
        if (!res || res.error) {
          setError("Invalid email or password.");
          return;
        }
        router.replace(callbackUrl);
        router.refresh();
      } else {
        const res = await signIn("nodemailer", { email, redirect: false, callbackUrl });
        if (!res || res.error) {
          setError("Could not send a sign-in link. Check the email address and try again.");
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

      <Field label="Email" name="email" type="email" autoComplete="email" required disabled={pending} />
      {mode === "password" && (
        <div className="space-y-1">
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
          />
          <div className="text-right">
            <Link href="/forgot-password" className="text-xs text-indigo-600 hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
      )}

      <SubmitButton pending={pending} pendingText={mode === "password" ? "Signing in…" : "Sending link…"}>
        {mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </SubmitButton>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMode(mode === "password" ? "magic" : "password");
          setError(null);
        }}
        className="w-full text-center text-sm text-indigo-600 hover:underline disabled:opacity-60"
      >
        {mode === "password" ? "Use a magic link instead" : "Use a password instead"}
      </button>
    </form>
  );
}
