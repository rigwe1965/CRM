import { join } from "node:path";
import PDFDocument from "pdfkit";

/**
 * Printable documents: a deal statement (what was bought, what was paid, what is still owed) and a
 * supplier invoice. Text is drawn as plain text only (pdfkit never reads markup in it), control
 * characters are stripped, and Noto Sans is embedded so names with accents (Vietnamese, Yoruba and
 * so on) print correctly, which the built-in PDF fonts cannot do.
 *
 * Internal margin figures stay out: the invoice shows the supplier's prices only.
 */

const FONT_DIR = join(process.cwd(), "node_modules", "@expo-google-fonts", "noto-sans");
export const FONT_FILES = {
  regular: join(FONT_DIR, "400Regular", "NotoSans_400Regular.ttf"),
  bold: join(FONT_DIR, "700Bold", "NotoSans_700Bold.ttf"),
} as const;

const MARGIN = 40;
const ROW = 16;
const WIDTH = 595.28 - MARGIN * 2;

/** Plain text for the page: no control characters, no surprises. */
const t = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const day = (d: Date) => d.toISOString().slice(0, 10);
const amount = (n: number, currency: string) =>
  `${new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${t(currency)}`;

type Doc = InstanceType<typeof PDFDocument>;
type Column = { header: string; width: number; align?: "left" | "right" };

function start() {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, font: FONT_FILES.regular, info: { Title: "Ivycandy Hair CRM" } });
  doc.registerFont("regular", FONT_FILES.regular);
  doc.registerFont("bold", FONT_FILES.bold);
  const chunks: Uint8Array[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (c: Uint8Array) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  return { doc, done };
}

function heading(doc: Doc, text: string) {
  doc.moveDown(0.8).font("bold").fontSize(11).fillColor("#111").text(text, MARGIN, doc.y, { width: WIDTH });
  doc.moveDown(0.3);
}

function facts(doc: Doc, pairs: [string, string][]) {
  doc.fontSize(9.5);
  for (const [label, value] of pairs) {
    const y = doc.y;
    doc.font("bold").fillColor("#555").text(label, MARGIN, y, { width: 110, lineBreak: false });
    doc.font("regular").fillColor("#111").text(t(value) || "-", MARGIN + 115, y, { width: WIDTH - 115 });
  }
}

function table(doc: Doc, columns: Column[], rows: string[][]) {
  const bottom = doc.page.height - MARGIN - ROW;
  const drawRow = (y: number, cells: string[], head: boolean) => {
    let x = MARGIN;
    if (head) doc.rect(MARGIN, y - 2, WIDTH, ROW).fill("#eee");
    doc.fillColor("#111").font(head ? "bold" : "regular").fontSize(8.5);
    columns.forEach((c, i) => {
      doc.text(t(cells[i]), x + 3, y + 1, { width: c.width - 6, height: ROW - 4, ellipsis: true, align: c.align ?? "left" });
      x += c.width;
    });
  };
  let y = doc.y;
  drawRow(y, columns.map((c) => c.header), true);
  y += ROW;
  for (const row of rows) {
    if (y > bottom) {
      doc.addPage();
      y = MARGIN;
      drawRow(y, columns.map((c) => c.header), true);
      y += ROW;
    }
    drawRow(y, row, false);
    y += ROW;
  }
  doc.y = y + 4;
  doc.x = MARGIN;
}

export type DealStatement = {
  generatedAt: Date;
  deal: { title: string; stage: string; currency: string; amount: number; customer: string; organization: string; owner: string };
  items: { productType: string; texture: string | null; lengthInches: string | null; color: string | null; laceType: string | null; quantity: number; unitPrice: number }[];
  payments: { paidAt: Date; method: string; reference: string | null; amount: number }[];
  instalments: { position: number; dueDate: Date; amount: number; covered: number; overdue: boolean }[];
  paid: number;
  balance: number;
};

export async function dealStatementPdf(d: DealStatement): Promise<Uint8Array> {
  const { doc, done } = start();
  const cur = d.deal.currency;
  doc.font("bold").fontSize(18).fillColor("#111").text("Deal statement", MARGIN, MARGIN);
  doc.font("regular").fontSize(9).fillColor("#555").text(`Prepared ${day(d.generatedAt)}`);
  doc.moveDown(0.8);
  facts(doc, [
    ["Deal", d.deal.title],
    ["Customer", d.deal.customer],
    ["Company", d.deal.organization],
    ["Stage", d.deal.stage.replace(/_/g, " ").toLowerCase()],
    ["Sales owner", d.deal.owner],
  ]);

  if (d.items.length) {
    heading(doc, "What was bought");
    table(
      doc,
      [
        { header: "Product", width: 110 }, { header: "Texture", width: 80 }, { header: "Length", width: 45 },
        { header: "Colour", width: 70 }, { header: "Lace", width: 60 }, { header: "Qty", width: 40, align: "right" },
        { header: "Unit price", width: 55, align: "right" }, { header: "Total", width: WIDTH - 460, align: "right" },
      ],
      d.items.map((i) => [
        i.productType, i.texture ?? "", i.lengthInches ?? "", i.color ?? "", i.laceType ?? "", String(i.quantity),
        amount(i.unitPrice, "").trim(), amount(Math.round(i.quantity * i.unitPrice * 100) / 100, "").trim(),
      ]),
    );
  }

  heading(doc, "Payments received");
  if (d.payments.length) {
    table(
      doc,
      [
        { header: "Date", width: 80 }, { header: "Method", width: 100 }, { header: "Reference", width: 215 },
        { header: `Amount (${t(cur)})`, width: WIDTH - 395, align: "right" },
      ],
      d.payments.map((p) => [day(p.paidAt), p.method.replace(/_/g, " ").toLowerCase(), p.reference ?? "", amount(p.amount, "").trim()]),
    );
  } else {
    doc.font("regular").fontSize(9.5).fillColor("#555").text("No payments recorded yet.", MARGIN, doc.y);
  }

  if (d.instalments.length) {
    heading(doc, "Payment schedule");
    table(
      doc,
      [
        { header: "#", width: 30 }, { header: "Due", width: 100 }, { header: "Amount", width: 110, align: "right" },
        { header: "Covered", width: 110, align: "right" }, { header: "Status", width: WIDTH - 350 },
      ],
      d.instalments.map((i) => [
        String(i.position), day(i.dueDate), amount(i.amount, "").trim(), amount(i.covered, "").trim(),
        i.covered >= i.amount ? "Paid" : i.overdue ? "Overdue" : i.covered > 0 ? "Part paid" : "Due",
      ]),
    );
  }

  heading(doc, "Summary");
  facts(doc, [
    ["Deal amount", amount(d.deal.amount, cur)],
    ["Paid", amount(d.paid, cur)],
    ["Balance owed", amount(d.balance, cur)],
  ]);
  doc.end();
  return done;
}

export type InvoiceDocument = {
  generatedAt: Date;
  invoice: {
    number: string; status: string; invoiceDate: Date; currency: string; vendorName: string; vendorRep: string | null;
    vendorPhone: string | null; billTo: string; subtotal: number; shipping: number; total: number; notes: string | null;
  };
  items: { ref: string; style: string; description: string; color: string | null; density: string | null; lengthInches: number | null; quantity: number; unitPrice: number; lineTotal: number }[];
};

export async function invoicePdf(d: InvoiceDocument): Promise<Uint8Array> {
  const { doc, done } = start();
  const v = d.invoice;
  doc.font("bold").fontSize(18).fillColor("#111").text(`Invoice ${t(v.number)}`, MARGIN, MARGIN);
  doc.font("regular").fontSize(9).fillColor("#555").text(`Prepared ${day(d.generatedAt)}`);
  doc.moveDown(0.8);
  facts(doc, [
    ["Date", day(v.invoiceDate)],
    ["Status", v.status.toLowerCase()],
    ["Supplier", v.vendorName],
    ["Supplier contact", [v.vendorRep, v.vendorPhone].filter(Boolean).join(", ")],
    ["Billed to", v.billTo],
    ["Currency", v.currency],
  ]);

  heading(doc, "Items");
  table(
    doc,
    [
      { header: "Ref", width: 30 }, { header: "Style", width: 70 }, { header: "Description", width: 150 },
      { header: "Colour", width: 50 }, { header: "Density", width: 40 }, { header: "Len", width: 30 },
      { header: "Qty", width: 30, align: "right" }, { header: "Unit", width: 55, align: "right" },
      { header: "Total", width: WIDTH - 455, align: "right" },
    ],
    d.items.map((i) => [
      i.ref, i.style, i.description, i.color ?? "", i.density ?? "", i.lengthInches === null ? "" : String(i.lengthInches),
      String(i.quantity), amount(i.unitPrice, "").trim(), amount(i.lineTotal, "").trim(),
    ]),
  );

  heading(doc, "Totals");
  facts(doc, [
    ["Items subtotal", amount(v.subtotal, v.currency)],
    ["Shipping", amount(v.shipping, v.currency)],
    ["Total", amount(v.total, v.currency)],
  ]);
  if (v.notes) {
    heading(doc, "Notes");
    doc.font("regular").fontSize(9.5).fillColor("#111").text(t(v.notes), MARGIN, doc.y, { width: WIDTH });
  }
  doc.end();
  return done;
}
