"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { fullName } from "@/lib/client/format";
import { useDuplicates } from "@/lib/client/hooks";

type Fields = { firstName: string; lastName: string; phone: string; email: string };

/**
 * Yellow notice under a contact form listing people who look the same (same phone or name). It only warns:
 * the form can still be saved, because two people can share a name or a family phone.
 */
export function DuplicateWarning({ fields, excludeId }: { fields: Fields; excludeId?: string }) {
  // Wait for a pause in typing so we don't ask the server on every keystroke.
  const [settled, setSettled] = useState(fields);
  useEffect(() => {
    const t = setTimeout(() => setSettled(fields), 500);
    return () => clearTimeout(t);
  }, [fields.firstName, fields.lastName, fields.phone, fields.email]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data } = useDuplicates({ ...settled, excludeId });
  if (!data || data.length === 0) return null;
  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="h-4 w-4 shrink-0" /> This may already be in your contacts
      </p>
      <ul className="mt-1.5 space-y-1">
        {data.map((d) => (
          <li key={d.id}>
            <Link href={`/contacts/${d.id}`} target="_blank" className="font-medium underline">
              {fullName(d)}
            </Link>{" "}
            <span className="text-xs">({d.reasons.join(", ")}{d.phone ? ` · ${d.phone}` : ""})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
