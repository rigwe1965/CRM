import Link from "next/link";
import { notFound } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { captchaSiteKey } from "@/lib/captcha";
import { signupEnabled } from "@/lib/signup";

export const metadata = { title: "Start your free trial · CRM" };
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  if (!signupEnabled()) notFound();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Start your free trial</h1>
        <p className="mt-1 text-sm text-muted-foreground">Set up your business&apos;s CRM. No card needed to start.</p>
      </div>
      <SignUpForm captchaSiteKey={captchaSiteKey()} />
      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/sign-in" className="text-primary hover:underline">Sign in</Link>
      </p>
    </>
  );
}
