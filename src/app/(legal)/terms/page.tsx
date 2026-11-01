import Link from "next/link";
import { LegalDoc, LegalSection, List, P } from "@/components/common/legal";
import { legalEntity } from "@/lib/legal";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const e = legalEntity();
  return (
    <LegalDoc
      title="Terms of Service"
      intro={
        <>
          These terms are the agreement between <strong>{e.name}</strong> (&quot;we&quot;, &quot;us&quot;) and the business that signs up for the service (&quot;you&quot;). By creating an account, or by accepting these terms inside the service, you agree to them for your business. If you accept for a business, you confirm that you may bind it.
        </>
      }
    >
      <LegalSection n={1} title="The service">
        <P>The service is a web-based customer management system for retailers: contacts, orders and deals, instalment payments, invoices, stock, tasks, messaging by email and WhatsApp, reports, and an optional AI assistant. We run it, host it and keep improving it. Features can change.</P>
      </LegalSection>

      <LegalSection n={2} title="Accounts and security">
        <List>
          <li>Give accurate details and keep your sign-in details private. Each person uses their own account.</li>
          <li>Administrators must turn on two-step verification. You are responsible for what is done with your accounts, and for removing people who leave.</li>
          <li>Tell us promptly at {e.email} if you think an account has been misused.</li>
        </List>
      </LegalSection>

      <LegalSection n={3} title="Your data">
        <List>
          <li>You own the data you put into the service, including your customers&apos; details (&quot;Your Data&quot;). You give us the right to host and process it only to run the service for you, as described in our <Link href="/privacy" className="underline">Privacy Policy</Link> and <Link href="/dpa" className="underline">Data Processing Addendum</Link>.</li>
          <li>You can export your data at any time, including after a trial or subscription has ended and while the workspace is read-only.</li>
          <li>You are responsible for having the right to hold and use your customers&apos; information, and for telling them what you do with it.</li>
        </List>
      </LegalSection>

      <LegalSection n={4} title="Acceptable use">
        <P>You will not use the service to break the law or anyone&apos;s rights, to send spam, to send messages to people who have not agreed to receive them where the law or the messaging provider requires agreement, to attack or probe the service, to resell it without our written agreement, or to store material you have no right to hold.</P>
        <List>
          <li><strong>Messaging.</strong> Before you email or WhatsApp a customer, you must have the consent the law and the provider (for WhatsApp, Meta) require. Importing a list into the service does not give you that consent, and the service does not record it for you.</li>
          <li><strong>Limits.</strong> Plans have limits on users, contacts and daily messages. Free trials may not send free-text email until you subscribe or verify your own sending domain.</li>
        </List>
      </LegalSection>

      <LegalSection n={5} title="Payments between you and your customers">
        <P>Orders, instalments and payment links record money between you and your customers. We are not a party to those sales and do not hold that money. Online card payments are handled by your own payment provider account (for example Stripe), under that provider&apos;s terms. You are responsible for refunds, chargebacks, tax and your own invoices.</P>
      </LegalSection>

      <LegalSection n={6} title="The AI assistant">
        <P>If you switch on the assistant, it uses an AI model through your own account with the model provider. It can be wrong. It suggests actions and drafts, and nothing it suggests changes your records or is sent to a customer until a person on your team approves it. You are responsible for checking what you approve and send.</P>
      </LegalSection>

      <LegalSection n={7} title="Plans, trials and fees">
        <List>
          <li>A new business starts on a free trial. When a trial ends, or a subscription is cancelled or unpaid, the workspace becomes read-only: you can view and export your data but not change it, until you subscribe.</li>
          <li>Paid plans are billed in advance through our payment provider at the price shown when you subscribe. Prices may change for future periods with notice. Taxes are added where they apply.</li>
          <li>You can cancel at any time; access continues to the end of the period you have paid for. Fees already paid are not refunded unless the law requires it or we agree otherwise.</li>
        </List>
      </LegalSection>

      <LegalSection n={8} title="Pilot and early versions">
        <P>While we label a feature or the service as a pilot or beta, it may change or have faults, and we give no uptime promise for it. We will tell you about planned downtime when we can and aim to fix serious problems quickly.</P>
      </LegalSection>

      <LegalSection n={9} title="Suspension and ending the agreement">
        <List>
          <li>We may suspend an account or business that breaks these terms, puts the service or other customers at risk, or does not pay, and we will tell you why when we reasonably can.</li>
          <li>You can ask to delete your business from Settings. The workspace becomes read-only for 30 days, during which you can export your data or change your mind. After that everything is erased for good, except what the law makes us keep (such as billing records held by our payment provider).</li>
          <li>Either of us may end the agreement by telling the other. Sections that by their nature should continue (fees owed, liability, governing law) do.</li>
        </List>
      </LegalSection>

      <LegalSection n={10} title="No guarantees, and limits on our liability">
        <P>The service is provided &quot;as is&quot;. To the extent the law allows, we do not promise that it will be uninterrupted or error-free, and we are not liable for indirect or consequential loss, lost profit, or lost data that you could have prevented by exporting it. Our total liability for anything arising from the service in any 12 months is limited to the fees you paid us in those 12 months. Nothing in these terms limits liability that the law does not allow to be limited, including for death or personal injury caused by negligence, or for fraud.</P>
      </LegalSection>

      <LegalSection n={11} title="Your responsibility to us">
        <P>You will cover losses we suffer from claims by third parties caused by your breach of section 4, or by Your Data infringing someone&apos;s rights, to the extent the law allows.</P>
      </LegalSection>

      <LegalSection n={12} title="Changes to these terms">
        <P>We may update these terms. When we make a material change we will ask an administrator to accept the new version inside the service and give notice by email where the change is significant. If you do not agree, you can export your data and end the agreement before the change applies to you.</P>
      </LegalSection>

      <LegalSection n={13} title="Law and disputes">
        <P>These terms are governed by the law of {e.governingLaw}. Courts there have jurisdiction, except where the law of your country gives you the right to bring a claim elsewhere. Please contact us first at {e.email}; most problems can be settled without a dispute.</P>
      </LegalSection>

      <LegalSection n={14} title="Who we are">
        <P>
          {e.name}, {e.address}. Email: {e.email}.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}
