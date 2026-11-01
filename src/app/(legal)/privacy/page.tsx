import Link from "next/link";
import { LegalDoc, LegalSection, List, P } from "@/components/common/legal";
import { SUBPROCESSORS } from "@/lib/legal-content";
import { legalEntity } from "@/lib/legal";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const e = legalEntity();
  return (
    <LegalDoc
      title="Privacy Policy"
      intro={
        <>
          This policy explains what personal information <strong>{e.name}</strong> handles when you use the service, why, who else sees it, and what rights you have. It covers two different situations, so please read section 1.
        </>
      }
    >
      <LegalSection n={1} title="Two roles">
        <List>
          <li><strong>Account information</strong> (the people who sign in): we decide how it is used, so we are the &quot;controller&quot;.</li>
          <li><strong>A business&apos;s customer data</strong> (the contacts, orders, payments and messages a business keeps in the service): the business decides how it is used and we handle it on its behalf, so the business is the controller and we are its &quot;processor&quot; under our <Link href="/dpa" className="underline">Data Processing Addendum</Link>. If you are a customer of a business that uses the service, contact that business about your information.</li>
        </List>
      </LegalSection>

      <LegalSection n={2} title="What we handle">
        <List>
          <li><strong>Account information:</strong> name, email address, role, a salted hash of the password (never the password itself), two-step verification secrets (stored encrypted), and records of sign-ins and actions (including the IP address) in a security log.</li>
          <li><strong>Business information you enter:</strong> contacts (names, emails, phone numbers, addresses), organisations, orders and deals, instalment schedules and payment records, supplier invoices, stock, tasks, notes, and messages sent or received by email and WhatsApp.</li>
          <li><strong>Payments:</strong> we never see or store card numbers. Subscription payments to us are taken by our payment provider. Payments from your customers go through your own payment provider account; we record the amounts and references.</li>
          <li><strong>The AI assistant (only if a business switches it on):</strong> the questions asked, the answers, and the parts of the business&apos;s records needed to answer are sent to the AI model provider through the business&apos;s own account. Documents uploaded for reading are processed for that request and not kept. Conversations are deleted 90 days after they were last used.</li>
          <li><strong>Technical information:</strong> temporary counters keyed by IP address and email address to limit abuse, and error reports with personal details removed.</li>
        </List>
      </LegalSection>

      <LegalSection n={3} title="Why we use it">
        <List>
          <li>To provide and secure the service and to carry out the agreement with the business (including billing).</li>
          <li>To prevent abuse and fraud, keep a security log, and fix faults (our legitimate interests).</li>
          <li>To meet legal duties, such as tax records.</li>
          <li>We do not sell personal information, and we do not use customer data for advertising or to train AI models.</li>
        </List>
      </LegalSection>

      <LegalSection n={4} title="Who else handles it">
        <P>We use the following service providers to run the service. Each may handle personal information only as needed for its role:</P>
        <ul className="list-disc space-y-1 pl-6">
          {SUBPROCESSORS.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong>: {s.role}{s.optional ? " (only if that feature is used)" : ""}.
            </li>
          ))}
        </ul>
        <P>We will update this list when it changes. We may also disclose information when the law requires it.</P>
      </LegalSection>

      <LegalSection n={5} title="Cookies">
        <P>We use only the cookies the service needs to work: a sign-in session cookie and security tokens that protect forms. We do not use advertising or analytics cookies. The sign-up page loads a bot check from Cloudflare.</P>
      </LegalSection>

      <LegalSection n={6} title="How long we keep it">
        <List>
          <li>While a business is active, we keep its data so it can use the service.</li>
          <li>If a business asks to delete itself, it has 30 days to change its mind or export; then its data is erased from the live service. Backups age out on the provider&apos;s backup schedule.</li>
          <li>Sign-ups never confirmed by email are deleted after 7 days.</li>
          <li>AI conversations are deleted 90 days after last use.</li>
          <li>Billing records are kept by our payment provider as the law requires.</li>
        </List>
      </LegalSection>

      <LegalSection n={7} title="Security">
        <P>Each business&apos;s data is kept apart from every other business&apos;s in the database itself, not just in the application. Passwords are hashed, saved third-party keys are encrypted, administrators must use two-step verification, connections are encrypted, and actions are written to a log that cannot be edited. No system is perfectly secure; if we learn that personal information has been exposed, we will tell the affected businesses without undue delay.</P>
      </LegalSection>

      <LegalSection n={8} title="Moving information between countries">
        <P>Our providers may process information in countries other than yours. Where the law requires it, we rely on safeguards such as standard contractual clauses. [Lawyer to confirm the transfer mechanism and the hosting regions used.]</P>
      </LegalSection>

      <LegalSection n={9} title="Your rights">
        <P>Depending on where you live, you may have the right to see, correct, delete or take a copy of your personal information, to object to some uses, and to complain to your data protection authority. Write to {e.email}. If your information is customer data held by a business, we will pass your request to that business. Businesses can export and delete their own data in Settings.</P>
      </LegalSection>

      <LegalSection n={10} title="Children">
        <P>The service is for businesses and is not aimed at children.</P>
      </LegalSection>

      <LegalSection n={11} title="Changes and contact">
        <P>
          When we change this policy in a way that matters we will say so inside the service. Questions: {e.email}, or {e.name}, {e.address}.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}
