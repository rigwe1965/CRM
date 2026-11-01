import { requireUser } from "@/lib/auth-helpers";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";
import { supportInfo } from "@/lib/support";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <Providers user={{ id: user.id, tenantId: user.tenantId, tenantWritable: user.tenantWritable, name: user.name ?? user.email ?? "You", email: user.email ?? "", role: user.role, mfaPending: user.mfaPending }}>
      <AppShell support={supportInfo()}>{children}</AppShell>
    </Providers>
  );
}
