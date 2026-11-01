import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGAL_DOCS, LEGAL_VERSION, legalEntity } from "@/lib/legal";

export const dynamic = "force-dynamic";

/** Shared frame for the terms, privacy policy and data processing addendum: public, readable, no app chrome. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const entity = legalEntity();
  return (
    <div className="min-h-screen bg-background text-foreground">
      {!entity.reviewed && (
        <div role="note" className="border-b bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Draft for review. These documents have not yet been approved by the business&apos;s lawyer, and details marked [to be completed] are still missing.
        </div>
      )}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/sign-in" className="text-sm font-medium underline">
          Back to sign in
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">{children}</main>
      <footer className="mx-auto max-w-3xl border-t px-4 py-6 text-sm text-muted-foreground">
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal documents">
          {LEGAL_DOCS.map((d) => (
            <Link key={d.href} href={d.href} className="underline">
              {d.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2">Version {LEGAL_VERSION}</p>
      </footer>
    </div>
  );
}
