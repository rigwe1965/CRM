import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-helpers";
import { safeRedirect } from "@/lib/rbac";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata = { title: "Sign in · CRM" };

export default async function SignInPage(
  props: {
    searchParams: Promise<{ callbackUrl?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  if (await getCurrentUser()) redirect(safeRedirect(searchParams.callbackUrl));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welcome back to your CRM.</p>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
      <p className="text-center text-sm text-muted-foreground">
        No account? Ask an administrator to invite you.
      </p>
    </>
  );
}
