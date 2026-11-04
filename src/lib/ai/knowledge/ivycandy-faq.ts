import type { KnowledgeInput } from "@/lib/ai/knowledge/types";

/**
 * Ivycandy Hair's product, care, shipping and wholesale FAQ, one question per entry so the lookup returns only what the
 * customer asked. Loaded with the returns policy by "Import default policy" in Settings > AI assistant; an admin can
 * then edit any entry, and an edited entry is never overwritten by a later import.
 * Wording follows the owner's FAQ and answers of 2026-11-04. The return policy is not repeated here: the returns entries
 * own it. Plain facts only, no instructions to the model.
 */
export const FAQ_VERSION = "2026-11-04";

const SUPPORT = "Customer support: WhatsApp +4917662044227, email ivycandyhair@gmail.com.";

export const DEFAULT_FAQ: readonly KnowledgeInput[] = [
  // ── Product quality & terms ──────────────────────────────────────────────
  {
    key: "faq-raw-virgin-remy",
    category: "PRODUCT_INFO",
    title: "Raw, virgin and Remy hair: what is the difference",
    keywords: ["raw", "virgin", "remy", "difference between raw and virgin", "unprocessed", "single donor", "cuticle", "cuticles aligned", "quality of hair"],
    body: `Virgin hair is 100% unprocessed human hair that has never been chemically treated, dyed or bleached. Raw hair is usually from a single donor, only cleaned, with the cuticles intact and aligned; it is the highest quality and lasts longest. Remy means all the cuticles face the same direction, which greatly reduces tangling and matting. Ivycandy Hair specialises in premium virgin and raw human hair.`,
  },
  {
    key: "faq-a-grade-myth",
    category: "PRODUCT_INFO",
    title: "Is the 8A, 9A, 10A grade system real",
    keywords: ["8a", "9a", "10a", "grade", "a grade", "hair grade", "12a", "grading"],
    body: `No. The letter grading system (8A, 9A, 10A and so on) is mostly a marketing tool created by suppliers. What matters is whether the hair is truly virgin or raw, from a single donor, and has aligned cuticles, not the number.`,
  },
  {
    key: "faq-100-human-hair",
    category: "PRODUCT_INFO",
    title: "Is all the hair 100% human hair",
    keywords: ["100% human", "synthetic", "blended", "real hair", "fake hair", "is it real human hair", "mixed with synthetic"],
    body: `Yes. Ivycandy Hair only sells 100% human hair. It is never blended with synthetic fibres.`,
  },
  {
    key: "faq-photos-vs-real",
    category: "PRODUCT_INFO",
    title: "Will the hair look exactly like the photos",
    keywords: ["photos", "pictures", "look like the photo", "same as picture", "colour difference", "color difference", "variation", "look the same"],
    body: `The photos give a good idea of texture and length. Because raw and virgin hair comes from real donors, slight natural differences in texture or colour between bundles are normal, and they help create a more realistic look once installed.`,
  },
  {
    key: "faq-textures",
    category: "PRODUCT_INFO",
    title: "Which hair textures are available",
    keywords: ["textures", "straight", "body wave", "deep wave", "loose wave", "curly", "kinky curly", "what textures do you have", "types of hair", "availability"],
    body: `Textures include Straight, Body Wave, Deep Wave, Loose Wave, Curly, Kinky Curly and other popular patterns. Availability changes, so ask support for what is in stock. ${SUPPORT}`,
  },
  {
    key: "faq-curly-looks-shorter",
    category: "PRODUCT_INFO",
    title: "Why curly or wavy hair looks shorter than the length ordered",
    keywords: ["shorter", "looks shorter", "length", "what length should i order", "curly length", "wavy length", "shrinkage", "measured straight", "how long will it look"],
    body: `Hair is measured when pulled straight and taut. Once it returns to its natural curl or wave pattern it looks about 2 to 6 inches shorter, depending on the texture. For curly and wavy textures, order 2 to 4 inches longer than the length you want to wear.`,
  },
  {
    key: "faq-dye-bleach",
    category: "PRODUCT_INFO",
    title: "Can the hair be dyed or bleached",
    keywords: ["dye", "dyed", "bleach", "bleaching", "colour the hair", "color the hair", "highlight", "lighten", "tint", "colouring"],
    body: `Yes, it is 100% human hair, so it can be dyed or bleached. A professional stylist is strongly recommended, especially for bleaching, because chemical processing can affect the hair's texture and how long it lasts. Hair that has been coloured, bleached or chemically treated may not qualify for a voluntary return (see the returns policy).`,
  },
  {
    key: "faq-natural-colour",
    category: "PRODUCT_INFO",
    title: "What is the natural colour of the hair",
    keywords: ["natural colour", "natural color", "1b", "natural black", "dark brown", "what colour", "what color", "shade"],
    body: `Most virgin and raw hair is natural black (1 or 1B) or a very dark brown. Slight differences between bundles are normal.`,
  },
  {
    key: "faq-cut-weft",
    category: "PRODUCT_INFO",
    title: "Can the weft be cut",
    keywords: ["cut the weft", "cutting weft", "trim weft", "weft unravel", "cut bundle", "shorten the weft"],
    body: `Machine wefts can usually be cut without unravelling, but cutting is not recommended unless necessary, because it can increase shedding at the cut edge. Cut or altered hair may not qualify for a voluntary return (see the returns policy).`,
  },
  {
    key: "faq-closure-vs-frontal",
    category: "PRODUCT_INFO",
    title: "Closure or frontal: what is the difference",
    keywords: ["closure vs frontal", "frontal vs closure", "difference between closure and frontal", "4x4", "5x5", "6x6", "13x4", "13x6", "ear to ear", "leave out", "which one should i choose"],
    body: `A closure (usually 4x4, 5x5 or 6x6) covers a smaller leave-out area at the crown or part. A frontal (13x4 or 13x6) runs from ear to ear and gives more styling flexibility: middle, side or free parts.`,
  },
  {
    key: "faq-hd-lace",
    category: "PRODUCT_INFO",
    title: "What is HD lace or transparent lace",
    keywords: ["hd lace", "transparent lace", "swiss lace", "invisible lace", "lace colour", "lace melt", "skin tone"],
    body: `HD (high definition) and transparent lace blend more naturally with a wide range of skin tones and are less visible than traditional lace.`,
  },

  // ── How many bundles ─────────────────────────────────────────────────────
  {
    key: "faq-bundles-full-sewin",
    category: "BUNDLE_GUIDE",
    title: "How many bundles are needed for a full sew-in",
    keywords: ["how many bundles", "bundles do i need", "number of bundles", "how many for a sew in", "full sew in", "sew-in", "how many packs", "how many bundles for 24 inch", "how many bundles for 30 inch"],
    body: `A general guide with 100g bundles: 10 to 16 inches needs 2 to 3 bundles; 18 to 22 inches needs 3 bundles; 24 to 28 inches needs 3 to 4 bundles; 30 inches and longer needs 4 or more. For extra fullness, or if your natural hair is fine, add one extra bundle.`,
  },
  {
    key: "faq-three-bundles-enough",
    category: "BUNDLE_GUIDE",
    title: "Are 3 bundles enough",
    keywords: ["3 bundles", "three bundles", "enough", "is 3 enough", "26 inch", "full look", "fullness"],
    body: `Yes for most styles up to 24 inches. For 26 inches and longer, or for a very full look, plan on 4 bundles.`,
  },
  {
    key: "faq-closure-still-need-bundles",
    category: "BUNDLE_GUIDE",
    title: "Are bundles still needed with a closure or frontal",
    keywords: ["closure and bundles", "frontal and bundles", "do i need bundles with a closure", "does a closure replace bundles", "closure only", "frontal only"],
    body: `Yes. A closure or frontal covers only the leave-out area. It does not replace the bundles needed for volume and length.`,
  },
  {
    key: "faq-bundle-weight",
    category: "BUNDLE_GUIDE",
    title: "How much does one bundle weigh",
    keywords: ["bundle weight", "grams", "100g", "how heavy", "ounces", "3.5 oz", "weigh", "thinner at longer length"],
    body: `A standard bundle weighs about 100 grams (3.5 oz). Longer lengths can look thinner because the same weight is spread over more length.`,
  },
  {
    key: "faq-mixing-lengths",
    category: "BUNDLE_GUIDE",
    title: "Mixing different lengths in one install",
    keywords: ["mix lengths", "mixing lengths", "different lengths", "which length to count", "longest length", "layered", "bundle deal"],
    body: `When bundles of different lengths are mixed, count the number of bundles by the longest length. Plan the bundle count for that length (see how many bundles are needed).`,
  },

  // ── Care, longevity, styling ─────────────────────────────────────────────
  {
    key: "faq-how-long-lasts",
    category: "CARE",
    title: "How long the hair lasts",
    keywords: ["how long does it last", "lifespan", "longevity", "durability", "how many years", "last long", "life of the hair", "will it last"],
    body: `With proper care a sew-in install lasts 4 to 8 weeks. The hair itself can be reused for 1 to 3 years or more; raw and virgin hair often lasts longest.`,
  },
  {
    key: "faq-shedding",
    category: "CARE",
    title: "Does the hair shed",
    keywords: ["shed", "shedding", "hair falling out", "losing hair", "fall out", "excessive shedding", "shedding a lot"],
    body: `A little shedding is normal with any wefted hair, especially in the first few washes. Heavy shedding usually comes from improper care or rough handling. If the hair sheds heavily from the moment it is delivered, contact support with photos; it is handled as a possible defective product. ${SUPPORT}`,
  },
  {
    key: "faq-wash-care",
    category: "CARE",
    title: "How to wash and care for the hair",
    keywords: ["wash", "washing", "care", "how to care", "shampoo", "conditioner", "sulfate", "detangle", "bonnet", "silk pillowcase", "satin", "maintain", "look after", "deep condition", "tangling"],
    body: `Use sulfate-free shampoo and conditioner and wash 1 to 2 times a week, or as needed. Deep condition regularly. Detangle gently from the ends to the roots with a wide-tooth comb or your fingers while the hair is wet and conditioned. Air dry or use low heat. Sleep on a satin or silk pillowcase or in a bonnet. Avoid heavy oils and products that cause build-up.`,
  },
  {
    key: "faq-heat-styling",
    category: "CARE",
    title: "Can the hair be straightened, curled or blow-dried",
    keywords: ["heat", "straighten", "straightener", "flat iron", "curling iron", "blow dry", "blow-dry", "heat protectant", "350", "temperature", "hot tools"],
    body: `Yes. Use a heat protectant and keep the temperature moderate: avoid heat above 350°F (177°C).`,
  },
  {
    key: "faq-sew-in-duration",
    category: "CARE",
    title: "How long does a sew-in last",
    keywords: ["sew in last", "how long can i keep a sew in", "install duration", "how often to redo", "take down", "when to remove sew in"],
    body: `A sew-in typically lasts 4 to 8 weeks, depending on how fast your natural hair grows and how well you maintain it.`,
  },
  {
    key: "faq-reuse-hair",
    category: "CARE",
    title: "Can the hair be reused after taking it down",
    keywords: ["reuse", "re-use", "reinstall", "use again", "second install", "after taking down", "wear again"],
    body: `Yes, if it is removed carefully and properly cleaned and conditioned.`,
  },
  {
    key: "faq-wigs-ponytails",
    category: "CARE",
    title: "Is the hair good for wigs, glueless installs and ponytails",
    keywords: ["make a wig", "wig making", "glueless", "ponytail", "custom wig from bundles", "other styles", "what can i use bundles for"],
    body: `Yes. The bundles work for sew-ins, custom wigs, glueless installs, ponytails and other styles.`,
  },
  {
    key: "faq-buying-mistakes",
    category: "CARE",
    title: "Common buying mistakes to avoid",
    keywords: ["mistakes", "tips", "advice before buying", "what to avoid", "avoid", "first time buyer", "beginner"],
    body: `Common mistakes: buying too few bundles for the length or fullness wanted; ordering curly or wavy hair at exactly the worn length you want (it will look shorter); using harsh shampoos or skipping deep conditioning; sleeping without satin protection; and bleaching or heavily processing the hair without a professional.`,
  },

  // ── Shipping ─────────────────────────────────────────────────────────────
  {
    key: "faq-free-shipping",
    category: "DELIVERY",
    title: "Is shipping free",
    keywords: ["free shipping", "free delivery", "shipping fee", "shipping cost", "delivery cost", "how much is shipping", "minimum for free shipping", "200"],
    body: `Shipping is free on orders above $200. For smaller orders, support can confirm the shipping cost for your destination. ${SUPPORT}`,
  },
  {
    key: "faq-processing-time",
    category: "DELIVERY",
    title: "How long it takes to process an order",
    keywords: ["processing time", "dispatch time", "how soon do you ship", "when will it ship", "handling time", "order processing", "how fast do you send", "dispatched"],
    body: `Orders are processed within 24 hours. Delivery time comes on top, depending on the destination.`,
  },
  {
    key: "faq-delivery-times",
    category: "DELIVERY",
    title: "How long delivery takes by region",
    keywords: ["delivery time", "how long does shipping take", "how long to arrive", "shipping time", "when will it arrive", "germany", "europe", "nigeria", "working days", "estimated delivery"],
    body: `Delivery takes about 2 to 3 working days within Germany, 3 to 5 working days within Europe, and about 14 working days to Nigeria. For other countries, support confirms the estimate. ${SUPPORT}`,
  },
  {
    key: "faq-international-shipping",
    category: "DELIVERY",
    title: "Do you ship internationally, and who pays import taxes",
    keywords: ["international", "worldwide", "ship abroad", "ship to my country", "outside germany", "overseas", "customs", "import tax", "import duty", "duties", "vat", "do you ship to"],
    body: `Yes, Ivycandy Hair ships worldwide. The customer pays any import tax and duties charged by the destination country. For delivery times to countries not listed, ask support. ${SUPPORT}`,
  },

  // ── Wholesale ────────────────────────────────────────────────────────────
  {
    key: "faq-wholesale",
    category: "WHOLESALE",
    title: "Wholesale and bulk pricing",
    keywords: ["wholesale", "bulk", "bulk order", "reseller", "resell", "volume discount", "trade account", "buy in bulk", "salon pricing", "minimum order", "discount"],
    body: `Wholesale is available. Wholesale orders of $1000 or more receive a 2% discount. To open a wholesale account or ask about volume pricing, contact support by WhatsApp +4917662044227 or email ivycandyhair@gmail.com.`,
  },
];
