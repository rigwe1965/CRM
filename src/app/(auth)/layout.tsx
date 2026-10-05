import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12 text-foreground">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
