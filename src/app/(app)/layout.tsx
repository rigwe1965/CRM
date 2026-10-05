import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { signOutAction } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-semibold">
            CRM
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/profile" className="hover:underline">
              {user.name ?? user.email}
            </Link>
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {user.role}
            </span>
            <form action={signOutAction}>
              <button className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
