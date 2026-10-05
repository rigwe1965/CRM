"use client";

import { useState, type FormEvent } from "react";
import { Alert, Field, SubmitButton, sendJson } from "./form-ui";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setPending(true);
    setError(null);
    const res = await sendJson("/api/password/forgot", "POST", { email });
    setPending(false);
    if (res.ok) setSent(true);
    else setError(res.error);
  }

  if (sent) {
    return (
      <Alert variant="success">
        If an account exists for that email, we&apos;ve sent a link to reset your password. It expires in 1 hour.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert variant="error">{error}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" required disabled={pending} />
      <SubmitButton pending={pending} pendingText="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
