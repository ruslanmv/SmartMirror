import "server-only";

import type { DraftItem, JobStatus, OutfitCandidate, StyleSuggestResult, TryOnCreated, WardrobeItem } from "@/lib/tools";

/**
 * Demo backend used when no SmartMirror/OllaBridge backend is configured, so
 * every Vercel preview is fully clickable. It holds no personal data: the
 * wardrobe is a fixed sample, additions live in memory for the lifetime of one
 * serverless instance, and try-on jobs are derived from the job id itself.
 */

const SEED: WardrobeItem[] = [
  { id: "demo_dress_slip", category: "dress", subcategory: "slip dress", color: "black", material: "silk", length: "midi", metadata: { name: "Silk slip dress", occasions: ["dinner", "date", "party", "evening"] } },
  { id: "demo_dress_wrap", category: "dress", subcategory: "wrap dress", color: "emerald", material: "satin", length: "midi", metadata: { name: "Satin wrap dress", occasions: ["wedding", "party", "dinner"] } },
  { id: "demo_dress_sun", category: "dress", subcategory: "sundress", color: "cream", material: "linen", length: "midi", metadata: { name: "Linen sundress", occasions: ["brunch", "weekend", "travel", "casual"] } },
  { id: "demo_top_blouse", category: "top", subcategory: "blouse", color: "ivory", material: "silk", metadata: { name: "Ivory silk blouse", occasions: ["office", "dinner", "date"] } },
  { id: "demo_top_knit", category: "top", subcategory: "knit", color: "camel", material: "cashmere", metadata: { name: "Cashmere crew knit", occasions: ["weekend", "travel", "office", "casual"] } },
  { id: "demo_top_tee", category: "top", subcategory: "t-shirt", color: "white", material: "cotton", metadata: { name: "Heavy cotton tee", occasions: ["casual", "weekend", "brunch", "travel"] } },
  { id: "demo_top_cami", category: "top", subcategory: "camisole", color: "burgundy", material: "satin", metadata: { name: "Satin camisole", occasions: ["party", "date", "evening"] } },
  { id: "demo_skirt_pleat", category: "skirt", subcategory: "pleated", color: "beige", material: "crepe", length: "midi", metadata: { name: "Pleated midi skirt", occasions: ["office", "brunch", "dinner"] } },
  { id: "demo_skirt_leather", category: "skirt", subcategory: "pencil", color: "black", material: "leather", length: "knee", metadata: { name: "Leather pencil skirt", occasions: ["party", "date", "evening", "office"] } },
  { id: "demo_pants_tailored", category: "pants", subcategory: "tailored trousers", color: "navy", material: "wool", metadata: { name: "Tailored wool trousers", occasions: ["office", "dinner", "travel"] } },
  { id: "demo_jeans_straight", category: "jeans", subcategory: "straight leg", color: "denim", material: "denim", metadata: { name: "Straight-leg jeans", occasions: ["casual", "weekend", "brunch", "travel", "date"] } },
  { id: "demo_blazer", category: "blazer", subcategory: "single breasted", color: "charcoal", material: "wool", metadata: { name: "Charcoal blazer", occasions: ["office", "dinner", "evening"] } },
  { id: "demo_coat_trench", category: "coat", subcategory: "trench", color: "beige", material: "cotton gabardine", metadata: { name: "Classic trench", occasions: ["travel", "office", "weekend"] } },
  { id: "demo_jacket_leather", category: "jacket", subcategory: "biker", color: "black", material: "leather", metadata: { name: "Leather biker jacket", occasions: ["casual", "date", "party", "weekend"] } },
  { id: "demo_shoes_heels", category: "heels", subcategory: "slingback", color: "black", material: "patent leather", metadata: { name: "Slingback heels", occasions: ["dinner", "date", "party", "wedding", "evening"] } },
  { id: "demo_shoes_loafers", category: "shoes", subcategory: "loafers", color: "brown", material: "leather", metadata: { name: "Leather loafers", occasions: ["office", "brunch", "travel"] } },
  { id: "demo_shoes_sneakers", category: "sneakers", color: "white", material: "leather", metadata: { name: "White sneakers", occasions: ["casual", "weekend", "travel", "brunch"] } },
  { id: "demo_boots_ankle", category: "boots", subcategory: "ankle", color: "chocolate", material: "suede", metadata: { name: "Suede ankle boots", occasions: ["weekend", "date", "office", "travel"] } },
  { id: "demo_bag_clutch", category: "bag", subcategory: "clutch", color: "gold", material: "metallic", metadata: { name: "Gold clutch", occasions: ["party", "wedding", "evening", "dinner"] } },
  { id: "demo_bag_tote", category: "bag", subcategory: "tote", color: "camel", material: "leather", metadata: { name: "Leather tote", occasions: ["office", "travel", "weekend"] } },
];

const added: WardrobeItem[] = [];

export function demoWardrobe(): WardrobeItem[] {
  return [...SEED, ...added];
}

export function demoAddItem(args: Record<string, unknown>): WardrobeItem {
  const str = (k: string) => (typeof args[k] === "string" && (args[k] as string).trim() ? (args[k] as string).trim().slice(0, 64) : null);
  const category = str("category");
  if (!category) throw new Error("category is required");
  const meta = (args.metadata && typeof args.metadata === "object" ? args.metadata : {}) as Record<string, unknown>;
  const item: WardrobeItem = {
    id: `demo_added_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    category,
    subcategory: str("subcategory"),
    color: str("color"),
    material: str("material"),
    metadata: { name: typeof meta.name === "string" ? meta.name.slice(0, 80) : undefined },
  };
  added.push(item);
  if (added.length > 100) added.shift();
  return item;
}

// ---- Add clothes (demo): photos wait in a review queue until confirmed ----

const DEMO_CATEGORIES = ["accessory", "bag", "bottom", "dress", "outerwear", "shoes", "top"];
const drafts: (DraftItem & { name?: string })[] = [];

export function demoIngest(args: Record<string, unknown>): WardrobeItem {
  const image = typeof args.image === "string" ? args.image : "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error("image is required");
  const id = `demo_draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // The demo has no classifier: the owner picks the category and colour.
  drafts.unshift({
    id,
    image_url: image.length < 400_000 ? image : null,
    suggested: { category: null, subcategory: null, color: null, pattern: null },
    confidence: {},
    alternatives: {},
    needs_review: ["category", "color"],
    categories: DEMO_CATEGORIES,
    name: typeof args.name === "string" ? args.name.slice(0, 80) : undefined,
  });
  if (drafts.length > 24) drafts.pop();
  return { id, category: "unsorted", metadata: {} };
}

export function demoReview(): DraftItem[] {
  return drafts.slice(0, 12).map(({ name: _name, ...d }) => d);
}

export function demoConfirm(args: Record<string, unknown>): WardrobeItem {
  const i = drafts.findIndex((d) => d.id === args.item_id);
  if (i < 0) throw new Error("Wardrobe item not found");
  const d = drafts[i]!;
  const str = (k: string) => (typeof args[k] === "string" && (args[k] as string).trim() ? (args[k] as string).trim().slice(0, 64) : null);
  const category = str("category");
  if (!category) throw new Error("category is required");
  drafts.splice(i, 1);
  const item: WardrobeItem = {
    id: d.id.replace("demo_draft_", "demo_added_"),
    category,
    subcategory: str("subcategory"),
    color: str("color"),
    metadata: { name: str("name") ?? d.name, image_url: d.image_url ?? undefined },
  };
  added.push(item);
  return item;
}

export function demoRemove(args: Record<string, unknown>): { removed: string } {
  const id = String(args.item_id ?? "");
  const i = drafts.findIndex((d) => d.id === id);
  if (i >= 0) drafts.splice(i, 1);
  const j = added.findIndex((a) => a.id === id);
  if (j >= 0) added.splice(j, 1);
  if (i < 0 && j < 0) throw new Error("Wardrobe item not found");
  return { removed: id };
}

type Slot = "dress" | "top" | "bottom" | "layer" | "shoes" | "bag";

function slotOf(item: WardrobeItem): Slot {
  const c = item.category.toLowerCase();
  if (/dress|jumpsuit/.test(c)) return "dress";
  if (/skirt|pant|jean|trouser|short/.test(c)) return "bottom";
  if (/blazer|coat|jacket|cardigan/.test(c)) return "layer";
  if (/shoe|heel|boot|sneaker|loafer|sandal/.test(c)) return "shoes";
  if (/bag|clutch|tote/.test(c)) return "bag";
  return "top";
}

const OCCASIONS: Record<string, string[]> = {
  dinner: ["dinner", "restaurant", "tonight"],
  date: ["date", "romantic"],
  party: ["party", "cocktail", "club", "celebration"],
  wedding: ["wedding", "ceremony", "gala"],
  office: ["office", "work", "meeting", "interview", "business"],
  brunch: ["brunch", "lunch", "cafe"],
  weekend: ["weekend", "errand", "saturday", "sunday"],
  travel: ["travel", "flight", "airport", "trip"],
  casual: ["casual", "relaxed", "comfortable", "everyday"],
  evening: ["evening", "night", "elegant", "sexy"],
};

const COLORS = ["black", "white", "ivory", "cream", "beige", "camel", "brown", "red", "burgundy", "pink", "green", "emerald", "blue", "navy", "denim", "grey", "charcoal", "gold"];

export function normalizeIntent(prompt: string) {
  const text = prompt.toLowerCase();
  const occasions = Object.entries(OCCASIONS)
    .filter(([, words]) => words.some((w) => text.includes(w)))
    .map(([k]) => k);
  const colors = COLORS.filter((c) => new RegExp(`\\b${c}\\b`).test(text));
  const categories = ["dress", "skirt", "jeans", "pants", "blazer", "jacket", "coat", "heels", "boots", "sneakers"].filter((c) =>
    text.includes(c),
  );
  return { occasions: occasions.length ? occasions : ["casual"], colors, categories, raw: prompt };
}

function itemScore(item: WardrobeItem, intent: ReturnType<typeof normalizeIntent>): number {
  const occ = (item.metadata?.occasions as string[] | undefined) ?? [];
  let s = 0.2;
  s += 0.18 * intent.occasions.filter((o) => occ.includes(o)).length;
  if (item.color && intent.colors.includes(item.color.toLowerCase())) s += 0.3;
  if (intent.categories.some((c) => item.category.toLowerCase().includes(c))) s += 0.35;
  return s;
}

const TITLES: Record<string, string[]> = {
  dinner: ["Candlelit dinner", "Quiet luxury", "After-dark polish"],
  date: ["Date-night ease", "Effortless allure", "Soft romance"],
  party: ["Cocktail hour", "Statement night", "Dance-floor ready"],
  wedding: ["Guest of honour", "Garden ceremony", "Celebration chic"],
  office: ["Boardroom sharp", "Modern tailoring", "Desk to dinner"],
  brunch: ["Sunday brunch", "Light and easy", "Café terrace"],
  weekend: ["Weekend uniform", "Off-duty edit", "City stroll"],
  travel: ["Carry-on classic", "Jet-set layers", "Arrival ready"],
  casual: ["Everyday easy", "Relaxed refined", "Off-duty edit"],
  evening: ["Evening elegance", "Night edit", "Moonlit minimal"],
};

export function demoSuggest(prompt: string, limit = 3): StyleSuggestResult {
  const intent = normalizeIntent(prompt);
  const items = demoWardrobe();
  const bySlot = (slot: Slot) =>
    items
      .filter((i) => slotOf(i) === slot)
      .map((i) => ({ i, s: itemScore(i, intent) }))
      .sort((a, b) => b.s - a.s);

  const dresses = bySlot("dress");
  const tops = bySlot("top");
  const bottoms = bySlot("bottom");
  const layers = bySlot("layer");
  const shoes = bySlot("shoes");
  const bags = bySlot("bag");

  const bases: Array<Array<{ i: WardrobeItem; s: number }>> = [];
  for (const d of dresses.slice(0, 2)) bases.push([d]);
  for (let k = 0; k < 3; k++) {
    const t = tops[k];
    const b = bottoms[k % Math.max(1, bottoms.length)];
    if (t && b) bases.push([t, b]);
  }

  const outfits = bases
    .map((base, idx) => {
      const pieces = [...base];
      const layer = layers[idx % Math.max(1, layers.length)];
      if (layer && layer.s > 0.35) pieces.push(layer);
      const shoe = shoes[idx % Math.min(2, Math.max(1, shoes.length))];
      if (shoe) pieces.push(shoe);
      const bag = bags[0];
      if (bag && bag.s > 0.3) pieces.push(bag);
      const score = Math.min(0.99, pieces.reduce((a, p) => a + p.s, 0) / pieces.length + 0.35);
      return { pieces, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const occasion = intent.occasions[0] ?? "casual";
  const titles = TITLES[occasion] ?? TITLES.casual!;
  const stamp = Date.now().toString(36);

  const result: OutfitCandidate[] = outfits.map(({ pieces, score }, idx) => {
    const names = pieces.map((p) => (p.i.metadata?.name ?? p.i.category).toLowerCase());
    const lead = names[0] ?? "piece";
    const rest = names.slice(1);
    const colorNote = intent.colors.length ? ` It keeps to the ${intent.colors.join(" and ")} you asked for.` : "";
    return {
      id: `demo_outfit_${stamp}_${idx}`,
      title: titles[idx % titles.length],
      item_ids: pieces.map((p) => p.i.id),
      score: Math.round(score * 100) / 100,
      explanation: `${/^[aeiou]/.test(lead) ? "An" : "A"} ${lead} anchors the look${rest.length ? `, finished with ${rest.slice(0, -1).join(", ")}${rest.length > 1 ? " and " : ""}${rest.at(-1)}` : ""}. Balanced for ${occasion === "casual" ? "an easy day" : `a ${occasion}`}.${colorNote}`,
    };
  });

  return { request_id: `demo_style_${stamp}`, normalized_intent: intent, outfits: result };
}

const DEMO_JOB_SECONDS = 9;

export function demoCreateTryOn(outfitId: string): TryOnCreated {
  return { job_id: `demo-job_${Date.now().toString(36)}_${outfitId.slice(0, 40)}`, status: "queued" };
}

export function demoJob(jobId: string): JobStatus {
  const match = /^demo-job_([0-9a-z]+)_/.exec(jobId);
  if (!match) throw new Error("Job not found");
  const elapsed = (Date.now() - parseInt(match[1]!, 36)) / 1000;
  const progress = Math.max(0, Math.min(1, elapsed / DEMO_JOB_SECONDS));
  const stage =
    progress < 0.15 ? "Queued on HomePilot" : progress < 0.4 ? "Reading body pose" : progress < 0.75 ? "Draping garments" : progress < 1 ? "Refining fabric and light" : "Done";
  return {
    id: jobId,
    status: progress >= 1 ? "succeeded" : progress < 0.15 ? "queued" : "running",
    progress,
    result: { stage, demo: true },
  };
}
