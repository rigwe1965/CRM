import Link from "next/link";

export const metadata = { title: "Access denied · CRM" };

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">Your role doesn&apos;t have permission to view that page.</p>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
