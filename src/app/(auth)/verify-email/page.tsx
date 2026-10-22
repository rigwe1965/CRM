import { Suspense } from "react";
import { notFound } from "next/navigation";
import { VerifyEmail } from "@/components/auth/verify-email";
import { signupEnabled } from "@/lib/signup";

export const metadata = { title: "Confirm your email · CRM" };
export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  if (!signupEnabled()) notFound();
  return (
    <>
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </>
  );
}
