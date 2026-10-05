"use client";

import { useState } from "react";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";

type FieldErrors = Record<string, string[]>;

/** Tracks server-side validation errors for a form and runs an async submit with error handling. */
export function useFormState() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  /** Resolves true on success. Field errors from the API are mapped to inputs via `err(name)`. */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setErrors({});
    setFormError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof ApiClientError && Object.keys(e.fieldErrors).length > 0) {
        setErrors(e.fieldErrors);
        setFormError("Please fix the highlighted fields.");
      } else {
        setFormError(errorMessage(e));
      }
      return false;
    }
  }

  return { run, formError, err: (name: string) => errors[name]?.[0] };
}

/** Header + <form> + footer used inside every entity dialog's <DialogContent>. */
export function FormShell({
  title,
  description,
  submitLabel,
  pendingLabel = "Saving…",
  pending,
  formError,
  onSubmit,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  pendingLabel?: string;
  pending: boolean;
  formError: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className={description ? undefined : "sr-only"}>{description ?? title}</DialogDescription>
      </DialogHeader>
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      {children}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Blank/whitespace → null so the API clears the field. */
export const nullable = (v: string) => (v.trim() === "" ? null : v.trim());

export const Grid2 = ({ children }: { children: React.ReactNode }) => (
  <div className="grid gap-4 sm:grid-cols-2">{children}</div>
);
