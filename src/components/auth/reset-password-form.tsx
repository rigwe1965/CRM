"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Field, SubmitButton, sendJson, type FieldErrors } from "./form-ui";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  if (!token) {
    return (
      <div className="space-y-4">
        <Alert variant="error">This reset link is missing its token.</Alert>
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    setError(null);
    if (password !== form.get("confirm")) {
      setFieldErrors({ confirm: ["Passwords do not match"] });
      return;
    }
    setFieldErrors({});
    setPending(true);
    const res = await sendJson("/api/password/reset", "POST", { token, password });
    if (res.ok) {
      router.replace("/sign-in?reset=1");
      return;
    }
    setError(res.error);
    setFieldErrors(res.fieldErrors);
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && !fieldErrors.password && (
        <Alert variant="error">
          {error}{" "}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        </Alert>
      )}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        disabled={pending}
        hint="At least 8 characters, with a letter and a number."
        error={fieldErrors.password?.[0]}
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required disabled={pending} error={fieldErrors.confirm?.[0]} />
      <SubmitButton pending={pending} pendingText="Updating…">
        Update password
      </SubmitButton>
    </form>
  );
}
