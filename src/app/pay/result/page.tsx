import { CheckCircle2 } from "lucide-react";

export const metadata = { title: "Payment" };

/** Where Stripe sends the customer after paying. Public, shows no deal or customer data. */
export default function PaymentResultPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
        <h1 className="text-xl font-semibold">Thank you, payment received</h1>
        <p className="text-sm text-muted-foreground">
          Your payment went through. A receipt from our payment provider is on its way to your email. You can close this page.
        </p>
      </div>
    </main>
  );
}
