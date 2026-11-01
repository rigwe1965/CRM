"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/components/providers";
import { errorMessage, useAcceptLegal, useLegal } from "@/lib/client/hooks";

/**
 * Asks an admin to accept the current terms, privacy policy and data processing addendum for the business: once for a
 * business created by us, and again whenever the wording changes. Other users never see it. It does not block the
 * workspace; the acceptance (who, when, which version) is written to the audit log.
 */
export function LegalBanner() {
  const isAdmin = useCurrentUser().role === "ADMIN";
  const { data } = useLegal(isAdmin);
  const accept = useAcceptLegal();
  const [agreed, setAgreed] = useState(false);
  if (!isAdmin || !data || data.accepted) return null;

  return (
    <div role="status" className="border-b bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:bg-blue-950 dark:text-blue-50 sm:px-6 print:hidden">
      <p className="font-medium">{data.acceptedVersion ? "Our terms have changed." : "Please review and accept our terms for your business."}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the <Link href="/terms" target="_blank" className="underline">Terms of Service</Link>,{" "}
            <Link href="/privacy" target="_blank" className="underline">Privacy Policy</Link> and{" "}
            <Link href="/dpa" target="_blank" className="underline">Data Processing Addendum</Link> for this business.
          </span>
        </label>
        <Button size="sm" disabled={!agreed || accept.isPending} onClick={() => accept.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
          {accept.isPending ? "Saving…" : "Accept"}
        </Button>
      </div>
    </div>
  );
}
