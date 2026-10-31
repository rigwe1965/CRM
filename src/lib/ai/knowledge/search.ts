import { db } from "@/lib/db";

/**
 * Finds the knowledge entries that bear on a customer's question. No embeddings and no extra service: the knowledge base
 * is a few dozen short entries, so a word-overlap score plus a small map from customer wording to topics is enough, and
 * it is predictable and free. The model still judges what the customer means; this only decides what it gets to read.
 */

const STOP = new Set("a an and are as at be but by can could do does for from had has have how i if in is it its me my of on or our so than that the their them then there these they this to up us was we what when where which who will with would you your am been being did get got just not please want need like about any also into very hair human".split(" "));

/** Cuts a word to a rough stem so "returned", "returns" and "returning" meet. */
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
export const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

/** Customer wording to the topic it points at. A match adds weight to every entry in that category. */
const INTENTS: { re: RegExp; category: string }[] = [
  { re: /exchang|swap|switch|(change|different|another)\b.{0,25}\b(length|texture|style|colou?r|curl|wave)|(length|texture|style)\b.{0,15}\b(change|different)/, category: "EXCHANGES" },
  { re: /wrong|incorrect|missing|not what i (ordered|asked)|mix.?up|incomplete|different (from|to) (the )?(photo|picture|advert|description)|not as (described|advertised|shown)/, category: "WRONG_MISSING" },
  { re: /damag|defect|faulty|broken|torn|ripped|shed|tangl|stain|bad quality|poor quality|not as (described|advertised)/, category: "DAMAGED" },
  { re: /cancel/, category: "CANCELLATION" },
  { re: /refund|money back|reimburs|pay.{0,10}back|chargeback/, category: "REFUNDS" },
  { re: /who pays|return (ship|post|cost|label)|postage|shipping (cost|fee)|cost to (send|return)/, category: "RETURN_SHIPPING" },
  { re: /custom|made.to.order|bespoke|personali[sz]|my measurements|made for me/, category: "CUSTOM_WIGS" },
  { re: /\bopen(ed)?\b|unseal|broke?n? seal|hygien|\bworn\b|tried (it )?on|install|glued|washed/, category: "HYGIENE" },
  { re: /\blate\b|delay|lost|not (yet )?(arrived|here|delivered|received)|where is my|tracking|courier|\bdelivery\b|parcel/, category: "DELIVERY" },
  { re: /bundle|extension|weft/, category: "BUNDLES" },
  { re: /\bwigs?\b|closure|frontal|\blace\b/, category: "WIGS_CLOSURES" },
  { re: /\blaw\b|legal|rights?\b|statutory|lawyer|solicitor|sue\b|consumer|warranty|guarantee|complain to/, category: "CUSTOMER_RIGHTS" },
  { re: /opening hours|business hours|what time|whatsapp number|phone number|contact (you|us|support)|email address|speak to (a )?(person|human|someone)|talk to (a )?(person|human)/, category: "SUPPORT" },
  { re: /\breturn|send (it )?back|give (it )?back|withdraw|14 days|change my mind/, category: "GENERAL_RETURNS" },
];

/** Topics where the statutory-rights entry must always travel with the answer. */
const RIGHTS_TOPICS = new Set(["GENERAL_RETURNS", "ELIGIBILITY", "HYGIENE", "REFUNDS", "EXCHANGES", "DAMAGED", "WRONG_MISSING", "CANCELLATION", "CUSTOM_WIGS", "WIGS_CLOSURES", "BUNDLES", "RETURN_SHIPPING"]);

export type KnowledgeRow = { key: string; category: string; title: string; body: string; basis: string; keywords: string[]; version: number; updatedAt: Date };

export const intentsOf = (query: string) => new Set(INTENTS.filter((i) => i.re.test(query.toLowerCase())).map((i) => i.category));

/** Ranks entries for a question. Pure, so the quality check can run it without a database. */
export function rankEntries<T extends Pick<KnowledgeRow, "category" | "title" | "body" | "keywords">>(entries: readonly T[], query: string, limit = 4): T[] {
  const q = query.toLowerCase();
  const qTokens = new Set(tokens(q));
  const intents = intentsOf(q);
  const scored = entries
    .map((e) => {
      let score = 0;
      // Words in the body alone are weak evidence ("hair" is in nearly every entry): an entry needs the topic, a keyword or a title word as well.
      let strong = false;
      if (intents.has(e.category)) { score += 6; strong = true; }
      for (const k of e.keywords) {
        const kw = k.toLowerCase();
        if (kw.includes(" ") ? q.includes(kw) : qTokens.has(stem(kw))) { score += kw.includes(" ") ? 4 : 2; strong = true; }
      }
      const title = new Set(tokens(e.title));
      const body = new Set(tokens(e.body));
      for (const t of qTokens) {
        if (title.has(t)) { score += 3; strong = true; }
        else if (body.has(t)) score += 1;
      }
      return { e, score: strong ? score : 0 };
    })
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, limit).map((s) => s.e);
  // A question about returns, refunds and the like always carries the statement that statutory rights stay in force.
  if (picked.some((e) => RIGHTS_TOPICS.has(e.category)) && !picked.some((e) => e.category === "CUSTOMER_RIGHTS")) {
    const rights = entries.find((e) => e.category === "CUSTOMER_RIGHTS");
    if (rights) picked.push(rights);
  }
  return picked;
}

/** The business's active entries that fit the question. Reads only the caller's own business. */
export async function searchKnowledge(tenantId: string, query: string, limit = 4) {
  const entries = await db.knowledgeEntry.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { key: true, category: true, title: true, body: true, basis: true, keywords: true, version: true, updatedAt: true },
  });
  return { total: entries.length, results: rankEntries(entries, query, limit) };
}
