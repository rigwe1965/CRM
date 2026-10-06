// Sample proforma invoice transcribed from a supplier's paper sheet (07.08.25).
// Row tuple: [ref, style, description, color, density, lengthInches, qty, unitPrice, lineTotal, resalePrice, note]
export type SampleRow = [string, string, string, string, string, number, number, number, number, number, string | null];

const BC5 = "SDD 5*5 closure bounce curl";
const BC57 = "SDD 5*7 closure bounce curl";
const F50 = "factory +50gram";

export const sampleInvoice = {
  number: "PI-20250807-001",
  invoiceDate: new Date("2025-08-07T00:00:00Z"),
  vendorName: "Yuzhou City Xiao Yuan Hair Crafts Co., Ltd. (Mayqueen Hair Vendor)",
  vendorRep: "Miss Catherine",
  vendorPhone: "00 8618738851397",
  billTo: "Faith Ivy",
  subtotal: 7945,
  shipping: 0,
  total: 7309,
  notes:
    "Proforma invoice, wholesale price. Deal price 7,309 agreed against a sheet total of 7,945. Handwritten note on sheet: \"7250 = 626 (euro)\". Resale prices are handwritten per piece.",
  rows: [
    ["1-1", "Layered bounce", BC5, "1b", F50, 16, 2, 123, 245, 160, "normal closure"],
    ["1-2", "Layered bounce", BC5, "1b", F50, 18, 2, 145, 289, 170, "normal closure"],
    ["1-3", "Layered bounce", BC5, "#4", F50, 16, 2, 132, 265, 165, "normal closure"],
    ["1-4", "Layered bounce", BC5, "#4", F50, 18, 2, 154, 309, 180, "normal closure"],
    ["1-5", "Layered bounce", BC5, "Dark burg", F50, 16, 2, 138, 276, 175, "normal closure"],
    ["1-6", "Layered bounce", BC5, "Dark burg", F50, 18, 2, 153, 307, 180, "normal closure"],
    ["1-7", "Layered bounce", BC57, "P2/350", F50, 12, 1, 98, 98, 120, null],
    ["1-8", "Layered bounce", BC57, "P2/350", F50, 18, 1, 154, 154, 175, null],
    ["1-9", "Layered bounce", BC57, "P2/350", F50, 20, 1, 183, 183, 200, null],
    ["1-10", "Layered bounce", BC57, "P2/350", F50, 22, 1, 216, 216, 220, null],
    ["2-1", "Flip over bounce", "SDD 2*6 closure flip bounce", "1b", F50, 16, 1, 113, 113, 140, null],
    ["2-2", "Flip over bounce", "SDD 2*6 closure flip bounce", "1b", F50, 18, 1, 129, 129, 150, "normal closure"],
    ["2-3", "Flip over bounce", "SDD 2*6 closure flip bounce", "1b", F50, 20, 1, 164, 164, 165, null],
    ["3-1", "Pixie curl", "SDD 5*5 closure pixie curl", "#4", F50, 14, 1, 124, 124, 125, null],
    ["3-2", "Pixie curl", "SDD 5*5 closure pixie curl", "#4", F50, 16, 1, 142, 142, 140, null],
    ["3-3", "Pixie curl", "SDD 5*5 closure pixie curl", "#4", F50, 18, 1, 160, 160, 145, null],
    ["4-1", "Kinky straight", "Single drawn kinky ponytail", "1b", "150gram", 22, 1, 98, 98, 110, null],
    ["4-2", "Kinky straight", "Single drawn kinky ponytail", "1b", "150gram", 24, 1, 117, 117, 120, null],
    ["5-1", "Crochet hair", "Deep curl", "1b", "100gram", 18, 2, 66, 132, 70, null],
    ["5-2", "Crochet hair", "Deep curl", "#4", "100gram", 18, 2, 68, 136, 75, null],
    ["6-1", "Fringe wig", "SDD pixie curl", "1b", "factory", 12, 3, 71, 212, 120, null],
    ["6-2", "Fringe wig", "SDD pixie curl", "Brown #4", "factory", 12, 3, 77, 230, 125, null],
    ["6-3", "Fringe wig", "SDD pixie curl", "P1b/99j", "factory", 12, 3, 77, 230, 125, null],
    ["7-1", "Italy curl", "SDD 5*5 closure italy curl", "1b", "factory +100gram", 20, 2, 228, 456, 230, null],
    ["7-2", "Italy curl", "SDD 5*5 closure italy curl", "1b", "factory +100gram", 24, 2, 367, 733, 340, null],
    ["8-1", "Loose deep", "SD 6*6 loose deep", "1B", "290-300gram", 22, 1, 173, 173, 190, "long closure"],
    ["8-2", "Loose deep", "SD 6*6 loose deep", "1B", "290-300gram", 24, 1, 190, 190, 210, "long closure"],
    ["8-3", "Loose deep", "SD 6*6 loose deep", "1B", "345-350gram", 28, 1, 256, 256, 270, "long closure"],
    ["8-4", "Loose deep", "SD 6*6 loose deep", "1B", "345-350gram", 30, 1, 287, 287, 290, "long closure"],
    ["9-1", "Bounce curl", BC57, "1b", F50, 12, 2, 97, 194, 115, null],
    ["9-2", "Bounce curl", BC57, "P4/350", F50, 12, 2, 107, 213, 125, null],
    ["9-3", "Bounce curl", BC57, "99j", F50, 12, 2, 107, 213, 125, "normal closure"],
    ["9-4", "Bounce curl", BC57, "#4", F50, 12, 2, 107, 213, 120, null],
    ["9-5", "Bounce curl", BC57, "P4/30", F50, 12, 2, 107, 213, 125, null],
    ["10-1", "Fumi deep", "SDD 2*6 fumi deep", "1b", F50, 16, 2, 113, 226, 125, "longer closure"],
    ["10-2", "Fumi deep", "SDD 2*6 fumi deep", "T1b/4", F50, 16, 2, 123, 245, 125, "longer closure"],
  ] as SampleRow[],
};
