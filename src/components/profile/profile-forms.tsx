"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Alert, Field, SubmitButton, sendJson, type FieldErrors } from "@/components/auth/form-ui";

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const res = await sendJson("/api/me", "PATCH", { name: new FormData(e.currentTarget).get("name") });
    setPending(false);
    if (res.ok) {
      setFieldErrors({});
      setMessage({ ok: true, text: "Profile updated." });
      router.refresh();
    } else {
      setFieldErrors(res.fieldErrors);
      setMessage({ ok: false, text: res.error });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {message && <Alert variant={message.ok ? "success" : "error"}>{message.text}</Alert>}
      <Field label="Name" name="name" defaultValue={name} required disabled={pending} error={fieldErrors.name?.[0]} />
      <div className="max-w-xs">
        <SubmitButton pending={pending} pendingText="Saving…">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    setError(null);
    if (newPassword !== form.get("confirm")) {
      setFieldErrors({ confirm: ["Passwords do not match"] });
      return;
    }
    setFieldErrors({});
    setPending(true);
    const res = await sendJson("/api/me/password", "POST", {
      currentPassword: hasPassword ? String(form.get("currentPassword") ?? "") : undefined,
      newPassword,
    });
    if (res.ok) {
      // Changing the password invalidates all sessions, so sign in again.
      await signOut({ callbackUrl: "/sign-in?passwordChanged=1" });
      return;
    }
    setError(res.error);
    setFieldErrors(res.fieldErrors);
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && !Object.keys(fieldErrors).length && <Alert variant="error">{error}</Alert>}
      {hasPassword && (
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          error={fieldErrors.currentPassword?.[0]}
        />
      )}
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        disabled={pending}
        hint="At least 8 characters, with a letter and a number. You'll be signed out everywhere afterwards."
        error={fieldErrors.newPassword?.[0]}
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required disabled={pending} error={fieldErrors.confirm?.[0]} />
      <div className="max-w-xs">
        <SubmitButton pending={pending} pendingText="Updating…">
          {hasPassword ? "Change password" : "Set password"}
        </SubmitButton>
      </div>
    </form>
  );
}
