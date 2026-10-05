import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-helpers";
import { safeRedirect } from "@/lib/rbac";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata = { title: "Sign in · CRM" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  if (await getCurrentUser()) redirect(safeRedirect(searchParams.callbackUrl));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-gray-600">Welcome back to your CRM.</p>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
      <p className="text-center text-sm text-gray-600">
        No account?{" "}
        <Link href="/sign-up" className="text-indigo-600 hover:underline">
          Sign up
        </Link>
      </p>
    </>
  );
}
