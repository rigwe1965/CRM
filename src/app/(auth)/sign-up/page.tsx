import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-helpers";
import { DEFAULT_REDIRECT } from "@/lib/rbac";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata = { title: "Sign up · CRM" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect(DEFAULT_REDIRECT);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start managing your customers.</p>
      </div>
      <SignUpForm />
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
