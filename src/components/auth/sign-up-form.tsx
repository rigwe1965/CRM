"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { DEFAULT_REDIRECT } from "@/lib/rbac";
import { Alert, Field, SubmitButton, sendJson, type FieldErrors } from "./form-ui";

export function SignUpForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setError(null);
    if (password !== form.get("confirm")) {
      setFieldErrors({ confirm: ["Passwords do not match"] });
      return;
    }
    setFieldErrors({});
    setPending(true);

    const res = await sendJson("/api/register", "POST", { name, email, password });
    if (!res.ok) {
      setError(res.error);
      setFieldErrors(res.fieldErrors);
      setPending(false);
      return;
    }

    const signedIn = await signIn("credentials", { email, password, redirect: false }).catch(() => null);
    if (!signedIn || signedIn.error) {
      router.replace("/sign-in");
      return;
    }
    router.replace(DEFAULT_REDIRECT);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && !Object.keys(fieldErrors).length && <Alert variant="error">{error}</Alert>}
      <Field label="Name" name="name" autoComplete="name" required disabled={pending} error={fieldErrors.name?.[0]} />
      <Field label="Email" name="email" type="email" autoComplete="email" required disabled={pending} error={fieldErrors.email?.[0]} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        disabled={pending}
        hint="At least 8 characters, with a letter and a number."
        error={fieldErrors.password?.[0]}
      />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required disabled={pending} error={fieldErrors.confirm?.[0]} />
      <SubmitButton pending={pending} pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
