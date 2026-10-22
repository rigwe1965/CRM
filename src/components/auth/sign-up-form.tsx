"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Turnstile } from "./turnstile";
import { Alert, Field, SubmitButton, sendJson, type FieldErrors } from "./form-ui";

export function SignUpForm({ captchaSiteKey }: { captchaSiteKey: string | null }) {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState<{ devLink?: string } | null>(null);

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
    const res = await sendJson("/api/signup", "POST", {
      businessName: String(form.get("businessName") ?? ""),
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password,
      captchaToken: captcha ?? undefined,
    });
    setPending(false);
    if (res.ok) {
      setDone({ devLink: (res.data as { devLink?: string } | undefined)?.devLink });
      return;
    }
    // A CAPTCHA token works once, so ask for a new one after any refusal.
    setCaptcha(null);
    setCaptchaRound((n) => n + 1);
    setError(res.error);
    setFieldErrors(res.fieldErrors);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert variant="success">Check your email. We sent a link to confirm your address; it expires in 24 hours. Your free trial starts when you confirm.</Alert>
        {done.devLink && (
          <p className="break-all rounded bg-muted p-2 font-mono text-xs">
            No email provider is set up, so here is the link: <Link href={done.devLink} className="underline">{done.devLink}</Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && Object.keys(fieldErrors).length === 0 && <Alert variant="error">{error}</Alert>}
      <Field label="Business name" name="businessName" autoComplete="organization" required disabled={pending} error={fieldErrors.businessName?.[0]} />
      <Field label="Your name" name="name" autoComplete="name" required disabled={pending} error={fieldErrors.name?.[0]} />
      <Field label="Email" name="email" type="email" autoComplete="email" required disabled={pending} error={fieldErrors.email?.[0]} />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required disabled={pending} hint="At least 10 characters, with a letter and a number." error={fieldErrors.password?.[0]} />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required disabled={pending} error={fieldErrors.confirm?.[0]} />
      {captchaSiteKey && <Turnstile siteKey={captchaSiteKey} onToken={setCaptcha} resetKey={captchaRound} />}
      <SubmitButton pending={pending || (!!captchaSiteKey && !captcha)} pendingText={pending ? "Creating…" : "Complete the check above"}>
        Start free trial
      </SubmitButton>
    </form>
  );
}
