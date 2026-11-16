import Link from "next/link";
import { LegalDoc, LegalSection, List, P } from "@/components/common/legal";
import { SUBPROCESSORS } from "@/lib/legal-content";
import { legalEntity } from "@/lib/legal";

export const metadata = { title: "Data Processing Addendum" };

export default function DpaPage() {
  const e = legalEntity();
  return (
    <LegalDoc
      title="Data Processing Addendum"
      intro={
        <>
          This addendum is part of the <Link href="/terms" className="underline">Terms of Service</Link> between <strong>{e.name}</strong> (&quot;the processor&quot;, &quot;we&quot;) and the business using the service (&quot;the controller&quot;, &quot;you&quot;). It applies to the personal information of your customers, leads and staff that you put into the service (&quot;Customer Data&quot;).
        </>
      }
    >
      <LegalSection n={1} title="What we do with Customer Data">
        <P>We process Customer Data only to provide the service to you and only on your documented instructions, which are these terms, your use of the settings and features, and any written instruction you give us. If the law requires us to do something else, we will tell you first unless the law forbids it. If we think an instruction breaks the law, we will say so.</P>
      </LegalSection>

      <LegalSection n={2} title="Details of the processing">
        <List>
          <li><strong>Subject:</strong> running the customer management service for you.</li>
          <li><strong>Duration:</strong> as long as your account exists, plus the 30-day deletion period in the Terms.</li>
          <li><strong>People concerned:</strong> your customers and leads, your suppliers&apos; contacts, and your staff.</li>
          <li><strong>Types of data:</strong> names, email addresses, phone numbers, addresses, order and payment records, notes, messages sent and received by email and WhatsApp, and whatever else you choose to enter.</li>
          <li><strong>No special categories:</strong> please do not enter health, biometric or similar sensitive data.</li>
        </List>
      </LegalSection>

      <LegalSection n={3} title="Our commitments">
        <List>
          <li>People who work for us and can reach Customer Data are bound by confidentiality, and only reach it when needed to run or support the service.</li>
          <li>We keep your data apart from every other customer&apos;s, in the database as well as in the application, and apply the security measures described in our <Link href="/privacy" className="underline">Privacy Policy</Link>: hashed passwords, encrypted stored keys, mandatory two-step verification for administrators, encrypted connections, a tamper-resistant action log, and tested backups.</li>
          <li>We help you answer requests from people exercising their rights (access, correction, deletion, export). Most of this you can do yourself in the service; for the rest, write to {e.email}.</li>
          <li>We tell you without undue delay, and within 72 hours of becoming aware, if we discover a breach affecting Customer Data, with what we know and what we are doing.</li>
          <li>We help you with data protection impact assessments and consultations with authorities where they concern our processing, as far as is reasonable.</li>
        </List>
      </LegalSection>

      <LegalSection n={4} title="Other providers we use">
        <P>You allow us to use these providers to process Customer Data. We have contracts with them that protect it to a similar standard, and we remain responsible for them. We will tell you inside the service or by email before adding or replacing one, and you may object on reasonable grounds; if we cannot resolve it, you may end the agreement.</P>
        <ul className="list-disc space-y-1 pl-6">
          {SUBPROCESSORS.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong>: {s.role}{s.optional ? " (only if that feature is used)" : ""}.
            </li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection n={5} title="Your own accounts with providers">
        <P>When you connect your own Stripe, WhatsApp (Meta) or AI (Anthropic) account, you are the one with the contract with that provider, and what it does with data is under your agreement with it.</P>
        <P>Where you use the AI included in your plan, or AI credit you have bought, instead of your own Anthropic account, the AI assistant runs on our account with Anthropic, and Anthropic is then our sub-processor for that processing. [Lawyer to confirm.]</P>
      </LegalSection>

      <LegalSection n={6} title="Transfers between countries">
        <P>Where Customer Data is moved to a country without an adequate level of protection, we use a lawful transfer mechanism such as standard contractual clauses. [Lawyer to confirm.]</P>
      </LegalSection>

      <LegalSection n={7} title="When the agreement ends">
        <P>You can export Customer Data at any time. After you ask to delete your business, and the 30-day period has passed, we erase Customer Data from the live service; copies in backups disappear as the backups expire. We keep only what the law requires us to keep.</P>
      </LegalSection>

      <LegalSection n={8} title="Checking our work">
        <P>On reasonable request we will give you the information needed to show that we meet this addendum, and allow reasonable audits by you or an auditor you appoint, with notice, during business hours, and without exposing other customers&apos; data. Where an independent security assessment exists, we will share a summary.</P>
      </LegalSection>

      <LegalSection n={9} title="If there is a conflict">
        <P>If this addendum and the Terms disagree about Customer Data, this addendum wins.</P>
      </LegalSection>
    </LegalDoc>
  );
}
