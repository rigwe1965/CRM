import Link from "next/link";

export const metadata = { title: "Check your email · CRM" };

export default function VerifyRequestPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-1 text-sm text-gray-600">
          If that address can sign in, a link is on its way. It expires in 15 minutes.
        </p>
      </div>
      <p className="text-center text-sm">
        <Link href="/sign-in" className="text-indigo-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
