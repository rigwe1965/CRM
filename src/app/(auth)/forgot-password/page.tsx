import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Forgot password · CRM" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Forgot your password?</h1>
        <p className="mt-1 text-sm text-gray-600">Enter your email and we&apos;ll send you a reset link.</p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-sm">
        <Link href="/sign-in" className="text-indigo-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
