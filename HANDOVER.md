# Ivycandy Hair CRM: Handover Guide

A step-by-step guide for the owner and the team. No technical knowledge needed. (Support staff: see `TECHNICIAN.md`.)

## 1. What this CRM is

Think of a **lemonade stand**. You **buy** lemons (money goes out) and **sell** cups (money comes in). You only know if you are winning when you see both.

Ivycandy Hair buys hair from suppliers in Asia and sells it to customers, who mostly pay in instalments. The CRM is an organised notebook that never forgets and does the maths:

| In the business | Where it lives in the CRM |
|---|---|
| A person who buys or asks | **Contacts** |
| A shop or company | **Companies** |
| A sale, with the hair ordered | **Deals** (with line items) |
| Money a customer has paid | **Payments** (on a deal) |
| An order placed with a supplier | **Invoices** |
| Hair you have vs hair you sold | **Stock** |
| Things to do (call, ship, chase) | **Tasks** and **Activities** |
| The scoreboard | **Dashboard** |

## 2. Signing in and who sees what

- **Admin** sees everything. **Sales** and **Support** see only records they own.
- Sample logins (from the seed): `admin@crm.test`, `sales@crm.test`, `support@crm.test`. The password is `SEED_USER_PASSWORD` in the `.env` file.
- There is no public sign-up. An admin invites each person in **Settings → Team**; they get an email to choose their password. Passwords need 10+ characters.
- **Two-step verification** (Settings → Security): scan a QR code with Google Authenticator or similar; sign-in then asks for a code. Save the recovery codes it shows once. If someone loses their phone, an admin uses **Team → Edit → Reset two-step verification**. **Admins must have it on** (on by default in production): until an admin enrols they sign in as a plain Sales user and see a banner pointing to Settings → Security. If the only admin loses their phone, run `npm run make-admin -- admin@example.com --reset-mfa` against the production database.
- **Sign out everywhere** (Settings → Security, or an admin on someone's row) ends all sessions, for example after a lost laptop. If the app runs on several servers, a role change or deactivation can take up to 30 seconds to reach all of them.
- **Audit log** (Settings → Audit log, admins only): who signed in, changed a role, edited or deleted what, and when. Click a row for details; a deleted invoice's full contents are kept there.

**Example:** Sam (Sales) creates a deal. Sam sees it and Admin sees it. Support does not.

## 3. Each process, with an example

Running example: **Adaeze Okafor**, Eisenbahnstr. 7, 79576 Weil am Rhein, Germany, phone +4915906462275. She bought Bounce Curl 12" and Pixie Curl 16", total $300.

### 3.1 Add a customer (Contacts)
1. Go to **Contacts**, then **New contact**.
2. Fill in name, phone and email. Set type to **Customer**.
3. Fill in the **address** fields (street, city, state, postal code, country).
4. Save.

*Example:* Adaeze is saved with her German address. It shows on her contact page.

### 3.2 Register a sale (Deals)
1. Go to **Deals**, then **New deal**. Pick the contact.
2. Under **Items**, add one line per product: product, colour, length, quantity, price. The deal amount is the total of the lines.
3. Choose the **currency**. Set the **stage**: Qualification, Discovery, Proposal, Negotiation, Closed Won or Closed Lost.
4. Save. You can drag cards between stages on the board.

*Example:* Deal "Adaeze Okafor order". Line 1: Bounce Curl, 12". Line 2: Pixie Curl, 16". Total $300.

### 3.3 Record payments and instalments
1. On the deal card, open the menu and choose **Payments**.
2. **Add payment:** amount, date, method (Bank transfer, Cash, Digital, Other).
3. Optional: **Set schedule** to split the price into instalments with due dates.
4. The card shows **paid**, **balance** and **overdue**.

Rules to know:
- Payments are applied to instalments **oldest first**.
- An instalment is **overdue** if it is not covered and its due date has passed. Due *today* is not overdue.
- You cannot pay more than the deal total. The deal total cannot drop below what is already paid.

*Example:* Total $300, three instalments of $100. Adaeze pays $100 now. Paid $100, balance $200, next due next month.

**Online payment links (USD and EUR deals).** In the deal's **Payments**, under **Payment links**, enter an amount (blank = everything still owed) and click **Create payment link**. Copy it, or send it by WhatsApp or email from the same row. The customer pays on a Stripe page; the payment then appears under **Payments received** by itself (method Digital, marked "paid online") and the balance, instalments and dashboard update. Notes:
- Open links count as collected, so links can never add up to more than the balance. **Cancel link** frees the amount.
- Each link takes one payment only.
- If a customer pays a link after the balance has dropped (for example you recorded a bank transfer meanwhile), the CRM does **not** record it. The link shows **Refund needed** and an urgent task is created for the deal owner: refund it in the Stripe dashboard.
- Refunds are made in Stripe, not in the CRM. If you refund, also remove the payment from **Payments received**.
- Needs the Stripe keys (see `TECHNICIAN.md`). Until then the section says online payment is not set up.

### 3.4 Add a supplier invoice (Invoices)
Three ways:
- **By hand:** **Invoices**, **New**. Fill in number, supplier, billed-to, and the lines.
- **Import:** **Import** and choose a CSV or Excel file. Lines are read and a form opens prefilled. You must still fill in the invoice number, supplier and billed-to, then click create. An error banner appears if one is missing.
- **Print:** open an invoice and click **Print**.

*Example:* `PI-20250807-001` from Yuzhou City Xiao Yuan is the sample (36 lines, 59 pieces, deal price $7,309). The printed subtotal says 7,945 but the lines add to 7,941, so check supplier sheets against the lines.

### 3.5 Stock on hand (Stock)
The **Stock** page compares what you bought (invoices) with what you sold (deals in Proposal, Negotiation or Closed Won). Lines are matched on **product + colour + length**, ignoring capital letters.

*Example:* Adaeze's deal has no colour or length that matches an invoice line, so it appears under **unmatched**. To fix, enter colour and length on the deal items exactly as on the invoice.

### 3.6 Tasks, activities and reminders
- **Tasks:** things to do with a due date and priority. A daily email reminds the owner.
- **Activities:** a log of notes, calls, emails and meetings on a contact or deal.
- **Instalment reminders:** a daily email goes out for instalments that are due.
- **WhatsApp:** a contact with a phone number in international form (`+49…`, `0049…`) gets a **WhatsApp** button. It opens a chat in WhatsApp with a greeting typed in; nothing is sent until you press send there. Afterwards click **Log message** in the pop-up to save it on the contact's timeline (or use **Log activity**, type WhatsApp, to record a message a customer sent you). On a deal's **Payments**, **Remind on WhatsApp** prefills the next instalment amount and due date. Numbers written like `0803…` need `DEFAULT_PHONE_COUNTRY_CODE` set (see `TECHNICIAN.md`); until then those contacts show no button. The CRM does not read your WhatsApp chats, so only messages you log appear.

*Example:* Task "Call Adaeze about 2nd instalment", due Friday, priority High.

### 3.7 Read the Dashboard
- **Stock spend:** what you paid suppliers.
- **Cash flow:** **collected** (paid so far), **owed** (balance customers still owe) and **overdue**, plus estimated profit.
- Money is shown **per currency**. USD and EUR are never added together.
- Deals count only when they are in a counted stage, which is why a new invoice alone does not change sales figures.

*Example:* Collected $100, owed $5,000 across 2 deals, overdue $0.

## 4. Sample data versus real data

- The seed gave sample contacts, companies, deals, tasks and one sample invoice. They stay as **training material**.
- Your real records: Adaeze Okafor's order, and invoices `-002` (Crown Hair, $5,166) and `-003` (Lilly Wigs, $245).
- **Never run `npm run db:seed` on a database holding real work.** It wipes everything and reloads the samples.
- To clear samples later, ask Claude or the technician to delete only the seed-owned rows and keep your real ones. Tip: put "Sample" in the name of practice records.

## 5. Known quirks and open items

- Sample invoice lines add to 7,941 but the printed subtotal is 7,945.
- A $200 payment on "Luxe Lace – Sample Order" was probably deleted during testing. Re-enter it if it was real.
- Stock matching is strict, so spelling and colour must agree.

## 6. Before going live (checklist)

1. Change or delete the three seeded accounts and passwords.
2. Set `CRON_SECRET` (without it the daily reminders are not protected).
3. Set an email provider (`RESEND_API_KEY`, or `EMAIL_SERVER` and `EMAIL_FROM`). Without one, no real emails are sent.
4. Create the production database, set `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.
5. Deploy, sign in, create your own admin, and do one test deal and payment.
6. Decide when to clear the sample data.
