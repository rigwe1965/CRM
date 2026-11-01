import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { supportInfo } from "@/lib/support";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const support = supportInfo();
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12 text-foreground">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        {children}
        {(support.email || support.statusUrl) && (
          <p className="border-t pt-4 text-center text-xs text-muted-foreground">
            {support.email && (
              <>
                Need help? <a className="underline" href={`mailto:${support.email}`}>{support.email}</a>
              </>
            )}
            {support.email && support.statusUrl && " · "}
            {support.statusUrl && (
              <a className="underline" href={support.statusUrl} target="_blank" rel="noopener noreferrer">
                System status
              </a>
            )}
          </p>
        )}
      </div>
        <p className="absolute bottom-4 text-center text-xs text-muted-foreground">
          <Link href="/terms" className="underline">Terms</Link> · <Link href="/privacy" className="underline">Privacy</Link>
        </p>
    </main>
  );
}
