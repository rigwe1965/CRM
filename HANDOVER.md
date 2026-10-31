# Ivycandy Hair CRM: Handover Guide

A step-by-step guide for the owner and the team. No technical knowledge needed. (Support staff: see `TECHNICIAN.md`.)

## 1. What this CRM is

Think of a **lemonade stand**. You **buy** lemons (money goes out) and **sell** cups (money comes in). You only know if you are winning when you see both.

Ivycandy Hair buys hair from suppliers in Asia and sells it to customers, who mostly pay in instalments. The CRM is an organised notebook that never forgets and does the maths:

| In the business | Where it lives in the CRM |
| --- | --- |
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

**Customer order page.** In the deal's **Payments**, **Customer order page** makes a private link (valid 90 days) that opens a page showing the customer their order, what they have paid, the payment plan and what is due, with a **Pay now** button for the amount due (card, via Stripe; USD and EUR only). **Copy customer link** or **Email link** gives it to them. **Regenerate** makes a new link and the old one stops working at once; **Switch off** closes it. The section shows when the link expires and how often it was opened. A closed, expired or made-up link shows only "This link is not working". The page shows no staff names or internal notes. Bank-transfer details are not on the page yet.
- **In reminders:** live payment reminders (email and WhatsApp) now carry this page's link, so the customer sees the full picture and can pay. If the link can't be made, they carry the plain Stripe payment link as before. Test mode still shows a placeholder.
- **In WhatsApp templates:** a blank can be set to **Customer order page link** (Settings → Templates). Sending then uses the order's live link, or makes one.

**Shipping.** Once a deal is **Closed won**, its card menu has **Shipping**. There you move the order along: Not started, Packed, Shipped, Delivered (and Returned if it comes back), and enter the carrier and tracking number. For DHL, UPS, FedEx and USPS there is an **Open carrier tracking** link; other carriers still save but have no link. Every change is noted on the customer's timeline, and Shipped and Delivered dates are stamped for you (moving a step back clears the dates that no longer apply). On the Deals board, the **To ship** button shows only won orders that are not started or packed. Only a won deal can be shipped.
- **Tell the customer:** **Send shipping update** (in the Shipping dialog, and as a button after you mark shipped) opens the WhatsApp **Template** tab with the order already chosen. A template blank set to **Tracking number** fills itself from the order; if the order has no tracking number you type it. You read the preview and press Send.
- **Automatic updates (off by default):** Settings → Automations → **Shipping updates on WhatsApp** can send a chosen approved template by itself when an order is marked Shipped and/or Delivered. It only goes to customers who agreed to WhatsApp messages, once per order and step. Only templates whose blanks fill themselves are offered (none that need typing). Save the tracking number *before* marking Shipped. If it can't send, a note on the order's timeline says why, and you can send it by hand.
- **On the customer page:** once an order has started shipping, the customer order page shows a **Delivery** box with the status, dates, tracking number and, for known carriers, a **Track your parcel** link.

**Campaigns (broadcast on WhatsApp).** Settings → **Campaigns** (admins only) sends one approved template to a group of customers who agreed to WhatsApp.
- **Build it:** **New campaign**: a name, an approved template, and who gets it (tags, contact type, lead status, source, "no order in the last N days", "all won orders paid in full"). Only customers who ticked the WhatsApp agreement and have a WhatsApp-ready number are ever included. The template's blanks may only be the customer's name or text you type once for everyone (nothing that depends on one order). A live count and sample names show who would get it, and how many more match but can't be messaged. One campaign may reach at most 2,000 customers.
- **Send it:** **Send…** on a draft. First **send yourself a test** (your own number): you get the real message. Then check the count, tick that you understand Meta charges for every message and sent messages can't be recalled, and press **Start sending**. Editing the draft clears the test. If the audience changed since you looked, it asks you to confirm again.
- **While it runs:** the Campaigns page sends in batches of 25 and shows progress, so keep it open for it to go fast. If you close it, the daily job carries on (about 40 seconds of sending a day, so a big campaign can then take days). **Stop** ends it for good: nobody else is messaged, and messages already sent stay sent. It pauses by itself, with the reason shown, when your plan's daily WhatsApp limit is used (it carries on the next day), Meta asks us to slow down, five messages in a row fail, or the template stops being approved. **Resume** carries on.
- **Safeguards:** nobody gets the same campaign twice; each customer is checked again just before their message, so someone who withdrew or was deleted since is skipped; two campaigns with the same template can't run at once. Every message is on the customer's timeline like any other template message.
- **Report:** **Show report** shows sent, delivered, read, replied (within 48 hours), failed, skipped and opted out, with the reasons. Delivered and read fill in over the minutes after sending.
- **Opt-out by reply:** a customer whose whole reply is **STOP**, **UNSUBSCRIBE**, **CANCEL** or **END** is opted out at once: the WhatsApp agreement is withdrawn, they are taken off any campaign still waiting, and a note appears on their timeline. A longer message ("please stop messaging me") still becomes a suggestion for the owner to approve. Ticking the agreement now records the date and who ticked it.
- **Costs:** Meta charges per message (marketing messages usually cost more than service messages). The CRM does not show a price; check Meta's pricing for your country before a big send.

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

- **Automations (admins: Settings → Automations).** Both are **off** until you switch them on.
  - **Stage tasks:** when a deal moves into a stage, a task is created for the deal's owner (for example *Order Confirmed* → "Send payment details to {customer}"). You choose the title, days until due and priority per stage. A deal gets one open task per stage, so dragging a card back and forth does not pile them up.
  - **Quiet leads:** once a day, a lead or prospect with nothing logged (on the contact or its deals) and no task completed for 7 days (you can change this) gets a follow-up task for its owner. Unqualified leads, contacts without an owner and brand-new contacts are skipped; a lead has at most one open follow-up. Before you switch it on, the screen shows how many tasks the first run would create, and sample leads count too. At most 500 are created per run, and they appear in the owner's daily task email.
  - **Customer payment reminders:** emails the customer about an instalment: a friendly reminder 2 days before it is due, a polite notice 1 day after it is late, and a firmer second notice after 7 days (all adjustable). After the second notice the deal owner gets a "call them" task. Replies go to the deal owner, and each email is logged on the contact and deal. It never sends for paid instalments, lost or deleted deals, contacts without an email or marked **Don't send automatic emails** (a checkbox in the contact form), or instalments more than 30 days overdue. When online payment (Stripe) is set up and the deal is in USD or EUR, a secure **Pay now** link for the amount due is added to the email; without it the email goes out as before. In **Test mode** the emails go to your test address and the pay button is only a placeholder.
  - **Your own wording:** under **Your own wording (optional)** in the same card, pick a notice and write your own subject and message. Leave a box empty to keep the built-in text. You can use `{name}`, `{amount}`, `{deal}`, `{dueDate}` and `{daysLate}`; they are filled in for each customer. The greeting, the Pay now button and the sign-off are always added. **Send sample** uses the wording on screen, so you can check it before saving.
  - **WhatsApp payment reminders:** the same three notices can also go out on WhatsApp, on the same days as the emails. Off by default, and it follows the same Test/Live mode (in Test mode every message goes to a test number you enter). A customer is only messaged if their contact has **This contact agreed to receive WhatsApp messages** ticked (tick it only when they have said yes) and a WhatsApp-ready phone number, and WhatsApp is set up under Settings → Integrations. On a deal's **Payments** screen, **Send on WhatsApp** sends one straight away, and the reminder list shows whether each one went by email or WhatsApp. After the second WhatsApp notice the owner gets the same "call them" task (one per instalment, even if the email went too).
    - **Why templates:** WhatsApp only lets a business start a conversation with a message template that Meta has approved. Create these three in Meta Business Manager (WhatsApp Manager → Message templates → Create template). Category **Utility**, language **English**, type **Text**, and use the names below exactly (or enter your own names in Settings → Automations). Replace "Ivycandy Hair" with your business name. Approval can take from minutes to a couple of days, and Meta charges per conversation.
    - **`payment_reminder_upcoming`**: "Hi {{1}}, this is a friendly reminder from Ivycandy Hair that your instalment of {{2}} is due on {{3}}. If you have already paid, thank you, and please ignore this message. To pay or ask a question: {{4}}" followed by a new line and "Thank you."
    - **`payment_reminder_overdue`**: "Hi {{1}}, we have not yet received your instalment of {{2}} to Ivycandy Hair, which was due on {{3}}. If you have already paid, thank you, and please let us know so we can check. Otherwise, please arrange the payment as soon as you can. To pay or ask a question: {{4}}" followed by a new line and "Thank you."
    - **`payment_reminder_final`**: "Hi {{1}}, your instalment of {{2}} to Ivycandy Hair (due {{3}}) is now overdue, and this is our second reminder. Please arrange the payment, or reply to tell us when we can expect it. If you have already paid, please send us the details so we can match it to your order. To pay or ask a question: {{4}}" followed by a new line and "Thank you."
    - **What fills the slots:** {{1}} first name, {{2}} amount (for example $100.00), {{3}} due date (2026-11-03), {{4}} the link to the customer's order page (or the Stripe pay link if that can't be made), or "just reply to this message" when no pay link can be made. When Meta asks for example values, give: Ada, $100.00, 2026-11-03, `https://example.com/pay`. Do not move a slot to the very start or end of the text; Meta rejects that.
    - **First check:** switch the mode to Test, enter your own WhatsApp number as the test number, save, open a deal with an unpaid instalment and press **Send on WhatsApp** (the contact needs the WhatsApp box ticked and a number). The template message arrives on your phone. A refused message shows Meta's reason, usually that a template is not approved yet or its name is spelled differently.
  - **Reminders on a deal:** open a deal’s **Payments** screen. **Payment reminders** lists every reminder email sent for it, and **Send reminder now** emails one unpaid instalment straight away (the notice matches how late it is). It follows the same Test/Live mode, skips customers who opted out, and will not send the same instalment twice within an hour. Admins see every deal; other users see their own.
    - It starts in **test mode**: every email goes to an address you choose, marked [TEST] with who would really have received it, and nothing else changes. Read a few, then switch to **Live**.
    - The screen shows how many emails the next run would send before you switch anything on.
  - **Low-stock alerts:** once a day, all active admins get one email listing the stock items that have dropped to or below their alert level (3 pieces unless you change it in Settings → Automations). Each item is mentioned once per dip; it is emailed again only after it has been restocked above its level. An admin can give an item its own level, or switch it off, with the bell button on the **Stock** page. The Stock page marks low items (and counts them) whether or not the email is on. Stock is counted for the whole business, even though other users see only their own stock on the page.
  - Stage tasks and quiet leads only create tasks for your own team. Low-stock alerts email only your admins. Only the customer payment reminders email customers, and only in Live mode.
  - The daily run needs the daily trigger (automatic on Vercel; on your own computer see `TECHNICIAN.md`).

- **Email templates (admins: Settings → Templates).** Ready-made wording for the **Send email** button on a contact. In a template you can write `{firstName}`, `{lastName}`, `{company}` and `{senderName}`; they are filled in when someone picks the template, and the person can still edit the text before sending. Anyone can use templates; only admins create, change or delete them. **Add starter templates** gives you a quote, a payment reminder and a shipping update to edit. Words in [square brackets] in a starter are for you to replace.
- **Tags.** In a contact's form, tick existing tags or type a new one and click **Add**. Tags show on the contact and in the contacts list, and the list has an **Any tag** filter. Everyone can add tags; admins rename or delete them in Settings → Tags (deleting removes the tag from every contact).
- **Two-way WhatsApp (needs Meta set-up first).** Once your WhatsApp Business number is connected through Meta and the four `WHATSAPP_` settings are in `.env`, customer messages appear on their contact (or create a new lead if the number is new), with a "Reply to WhatsApp" task for the owner. On a contact who wrote within the last 24 hours, **Reply here** sends from the CRM. After 24 hours WhatsApp only allows pre-approved templates; see **WhatsApp templates** just below. Messages you send from the CRM show on the contact as **Delivered**, **Read**, or **Not delivered** with Meta's reason, once Meta reports it (older messages and payment reminders show nothing extra). Until you have the Meta account, number and credentials, this does nothing and the rest of the CRM is unaffected.
- **WhatsApp templates (admins set up, everyone can send).** A template is a message Meta has approved in advance. It is the only kind a business can send to start a conversation or after the customer's 24 hours are over.
  - **One-time set-up:** create your templates in Meta's WhatsApp Manager (the three payment reminders above, and any others such as "your order has shipped") and wait for Meta to approve them. In **Settings → Integrations → WhatsApp**, also enter your **WhatsApp Business Account ID** (WhatsApp Manager shows it; digits only). Then open **Settings → Templates → WhatsApp templates** and press **Refresh from Meta**. Press it again whenever you create or change a template in Meta.
  - **Switch on and name the blanks:** each template shows Meta's status (Approved, Waiting for Meta, Rejected, ...). Only an approved one can be switched **On**. Use the sliders button to say what fills each blank, for example {{1}} = the customer's first name, {{2}} = the amount due, {{3}} = the next due date, or "typed when sending" for something like a tracking number. A template with a picture or a button that takes a value is marked **Not sendable yet**.
  - **Sending:** on a contact who has **agreed to WhatsApp messages** (the tick on the contact) and has a WhatsApp-ready number, press **Send template** (or the **Template** tab of the WhatsApp window). Pick the template, pick the order if it uses order details, type anything it asks for, check the preview and send. The finished message is logged on the contact and the order. If something it needs is missing (nothing owed, no due date, an empty field), nothing is sent and it tells you which.
  - **Test mode does not apply:** the Test/Live switch is for the automatic payment reminders. A template you send yourself goes to the customer.
  - Meta charges per conversation, and it can refuse or pause a template; the reason appears in the message or on the template.
- **Website enquiry form.** Settings → **Lead form** gives you a block of code to paste into your website. Visitors who send it appear in Contacts as a new lead with the source "Website"; the person you chose gets a "Reply to website enquiry" task and an email. If the visitor is already a contact, their message is just added to that contact. Before it works from your site, add the site's address to `LEAD_FORM_ORIGINS` in `.env` and restart the CRM; the email alert also needs the email provider set up.
- **Reports.** **Reports** in the left menu shows money received per month (one chart per currency), the average days customers take to pay, best-selling products, and which lead sources turn into customers. Pick 6, 12 or 24 months. Sales users see only their own numbers; admins see everything.
- **Duplicate warning and merge.** When you type a contact's name or phone, a yellow box lists anyone already in your contacts with the same phone number or the same name, so you can open them instead of adding a second copy. It only warns; you can still save. If the same person ended up in twice, an admin opens one of them and clicks **Merge**, picks the one to keep, and all deals, activities, tasks and tags move over. The extra copy is removed.
- **Saved views.** On the Contacts page, once you have a search or filter set, click **Save this view** and name it. It appears as a chip above the filters: click to apply it again, or the cross to delete it. Views are private to you, and you can keep 20.

*Example:* Task "Call Adaeze about 2nd instalment", due Friday, priority High.

### 3.7 Read the Dashboard

- **Stock spend:** what you paid suppliers.
- **Cash flow:** **collected** (paid so far), **owed** (balance customers still owe) and **overdue**, plus estimated profit.
- Money is shown **per currency**. USD and EUR are never added together.
- Deals count only when they are in a counted stage, which is why a new invoice alone does not change sales figures.

*Example:* Collected $100, owed $5,000 across 2 deals, overdue $0.

### 3.8 Export your data (CSV and PDF)

- **Export button.** Most pages (Companies, Deals, Invoices, Stock, Tasks, Activities, Dashboard) have an **Export** button next to the page title. It downloads a CSV file that opens in Excel or Google Sheets. It exports what your current search and filters show, and you see the number of rows before it downloads. On **Deals**, the menu also has deal items, payments and instalments; on **Invoices**, the invoice lines. The **Stock** file is always the whole stock list, because the search box only filters the screen.
- **Export only the rows you choose.** On Contacts, Companies, Deals, Invoices, Tasks and Activities the Export menu has **Choose rows: …** next to **All matching: …**. Choose rows opens a list of what the page is showing with nothing ticked: tick the rows you want (or **Tick all shown**), untick any time, and the button shows how many will be downloaded. It lists the first 100 rows of your current search; use the page's search to narrow it first. Only the ticked rows go into the file. It is also in **Stock** (pick stock rows), on **Invoices → Invoice lines** (tick invoices, get their lines) and on **Deals → Deal items / Payments / Instalments** (tick deals, get those deals' items, payments or instalments).
- **Choose which invoice lines go into the PDF.** On an invoice with more than one line, **Choose lines (PDF)** lists every line, all ticked: untick the ones to leave out. The PDF then shows only those lines, with their own subtotal and a "Partial copy" note instead of the full invoice total and shipping.
- **You only get your own data.** Same rule as the screens: everyone exports what they own, admins export everything. **Contacts** can be exported by admins only, because they hold emails, phone numbers and addresses. In everyone else's files a customer appears by name only.
- **PDF.** Open a deal's **Payments** and click **Download statement (PDF)** for a printable summary of what was bought, what was paid, the schedule and the balance. On an invoice, click **Download PDF**. The invoice PDF leaves out your resale prices.
- **Limits.** 5 exports per person every 10 minutes, and at most 50,000 rows per file. If a file is too big the CRM tells you to narrow it with search or filters. Every export is recorded in the audit log (who, what, how many rows).
- **Admins: Settings → Data export.** Download **everything** as a zip (one CSV per area, including deleted records and the audit log), the **audit log** on its own, or the **deleted records** of one area. These ask for a fresh code from your authenticator app (a code works once, so enter a new one each time). The zip is a copy to keep, **not a backup you can restore from**: use the database backup in `TECHNICIAN.md` for that.
- **Look after the files.** They hold customer details and payment amounts. Keep them private, store the zip encrypted, and delete copies you no longer need.
- A text cell that starts with `=`, `+`, `-` or `@` (for example a phone number such as `+234 …`) gets a `'` in front of it in the file. That is deliberate: it stops a spreadsheet from running it as a formula.

### 3.9 Starting the CRM: normal or fast

- **`start-crm.bat`** is the normal start. It is the development server: slower (a page can take half a second, and the first visit to each page a few seconds while it compiles), but it prints emails (invitations, password resets) to its window and needs no setup.
- **`start-crm-fast.bat`** runs the same CRM as a finished build: pages open about **6 times faster** and there are no compile pauses. The first start, and the first start after any code change, builds for about a minute; after that it starts at once. Close the normal window first, because both use the same address (`localhost:3001`).
- **Before using fast mode, turn on two-step verification for the admin account** (Settings → Security). In fast mode an admin without it only gets a Sales-level view of their own data until they do.
- **Fast mode does not send emails.** Inviting a user, password-reset links and reminder emails need an email provider (see section 6). Use the normal start for those, or set a provider.

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
