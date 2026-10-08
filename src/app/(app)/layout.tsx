import { requireUser } from "@/lib/auth-helpers";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <Providers user={{ id: user.id, name: user.name ?? user.email ?? "You", email: user.email ?? "", role: user.role, mfaPending: user.mfaPending }}>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
