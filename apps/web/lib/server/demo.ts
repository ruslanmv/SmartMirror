import "server-only";

import { clarification, offerFor, parseIntent } from "@/lib/intent";
import type {
  DraftItem,
  JobStatus,
  OutfitCandidate,
  OutfitSetView,
  ShopOffer,
  StyleSuggestResult,
  TryOnCreated,
  WardrobeItem,
} from "@/lib/tools";

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
    // A confirmed piece is named after what the owner confirmed ("navy skirt"), not the draft placeholder.
    metadata: {
      name: str("name") ?? ([str("color"), str("subcategory") ?? category].filter(Boolean).join(" ") || d.name),
      image_url: d.image_url ?? undefined,
    },
    created_at: new Date().toISOString(),
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
  // Canonical categories from the review queue first ("bottom", "outerwear").
  if (/bottom|skirt|pant|jean|trouser|short/.test(c)) return "bottom";
  if (/outerwear|blazer|coat|jacket|cardigan/.test(c)) return "layer";
  if (/shoe|heel|boot|sneaker|loafer|sandal/.test(c)) return "shoes";
  if (/bag|clutch|tote/.test(c)) return "bag";
  return "top";
}

// The sample wardrobe tags pieces with these words; each lexicon occasion maps onto them.
const OCCASION_TAGS: Record<string, string[]> = {
  date: ["date", "dinner", "evening"],
  evening: ["dinner", "party", "evening", "wedding"],
  office: ["office"],
  interview: ["office"],
  casual: ["weekend", "brunch", "casual"],
  shopping: ["weekend", "casual", "travel"],
  home: ["casual", "weekend"],
  active: ["casual"],
  travel: ["travel"],
};

// Vibe → what carries it in the sample wardrobe (names/categories), its colours, and what fights it.
const VIBE_PREFS: Record<string, { like: RegExp; colors: string[]; avoid?: RegExp }> = {
  alluring: { like: /slip|pencil|heel|slingback|cami|leather|wrap/, colors: ["black", "red", "burgundy"], avoid: /knit|tee|sneaker|trench/ },
  romantic: { like: /dress|blouse|pleated|slingback|cami|wrap/, colors: ["cream", "ivory", "pink", "burgundy", "red", "emerald"], avoid: /sneaker|tee/ },
  confident: { like: /blazer|tailored|trench|loafer|boot|pencil/, colors: ["navy", "charcoal", "black"], avoid: /tee|sneaker/ },
  relaxed: { like: /tee|t-shirt|knit|jean|sneaker|sundress|tote/, colors: [], avoid: /heel|slingback|slip|pencil|blazer/ },
  bold: { like: /wrap|cami|leather|pencil/, colors: ["emerald", "burgundy", "red", "gold"] },
  playful: { like: /sundress|pleated|sneaker|tee/, colors: ["pink", "red", "cream"] },
  minimal: { like: /tee|tailored|trench|loafer/, colors: ["black", "white", "navy", "beige", "camel"] },
  elegant: { like: /slip|blouse|slingback|blazer|trench|clutch|pleated/, colors: ["black", "ivory", "navy", "camel"], avoid: /sneaker|tee/ },
  sporty: { like: /sneaker|tee|jean/, colors: [], avoid: /heel|slingback|blazer/ },
};

const COLORS = ["black", "white", "ivory", "cream", "beige", "camel", "brown", "red", "burgundy", "pink", "green", "emerald", "blue", "navy", "denim", "grey", "charcoal", "gold"];

export function normalizeIntent(prompt: string, hour: number | null = null) {
  const text = prompt.toLowerCase();
  const read = parseIntent(prompt, hour);
  const colors = COLORS.filter((c) => new RegExp(`\\b${c}\\b`).test(text));
  const categories = ["dress", "skirt", "jeans", "pants", "blazer", "jacket", "coat", "heels", "boots", "sneakers"].filter((c) =>
    text.includes(c),
  );
  return { ...read, colors, categories, raw: prompt };
}

function itemScore(item: WardrobeItem, intent: ReturnType<typeof normalizeIntent>): number {
  const tags = (item.metadata?.occasions as string[] | undefined) ?? [];
  const words = `${item.category} ${item.subcategory ?? ""} ${item.metadata?.name ?? ""}`.toLowerCase();
  const color = item.color?.toLowerCase() ?? "";
  let s = 0.2;
  if (intent.occasion) s += 0.18 * (OCCASION_TAGS[intent.occasion] ?? []).filter((o) => tags.includes(o)).length;
  const vibe = intent.vibe ? VIBE_PREFS[intent.vibe] : undefined;
  if (vibe) {
    if (vibe.like.test(words)) s += 0.25;
    if (vibe.colors.includes(color)) s += 0.15;
    if (vibe.avoid?.test(words)) s -= 0.3;
  }
  if (intent.occasion && ["shopping", "home", "travel", "active"].includes(intent.occasion) && /heel|slingback/.test(words)) s -= 0.4;
  if (color && intent.colors.includes(color)) s += 0.3;
  if (intent.categories.some((c) => item.category.toLowerCase().includes(c))) s += 0.35;
  return s;
}

const TITLES: Record<string, string[]> = {
  alluring: ["After-dark allure", "Silk and shine", "Confident lines"],
  romantic: ["Soft romance", "Love-day ease", "Candlelit"],
  date: ["Date-night ease", "Soft romance", "Candlelit dinner"],
  evening: ["Evening elegance", "Night edit", "Cocktail hour"],
  office: ["Boardroom sharp", "Modern tailoring", "Desk to dinner"],
  interview: ["First impression", "Quiet authority", "Sharp and steady"],
  shopping: ["City stroll", "All-day walker", "Easy layers"],
  home: ["Cosy day in", "Soft and slow", "Sofa chic"],
  active: ["Ready to move", "Active ease", "Off to train"],
  travel: ["Carry-on classic", "Jet-set layers", "Arrival ready"],
  casual: ["Everyday easy", "Relaxed refined", "Off-duty edit"],
  bold: ["Statement night", "Colour first", "Turn heads"],
  confident: ["Power edit", "Sharp and steady", "Boss mode"],
};

const REASONS: Record<string, string> = {
  date: "romantic and polished for a date",
  evening: "polished for the evening",
  office: "sharp enough for work",
  interview: "composed and sharp for an interview",
  shopping: "easy to walk in all day",
  home: "soft and comfortable for a day in",
  active: "ready to move",
  travel: "comfortable for a long day",
  casual: "relaxed and easy",
};
const VIBE_REASONS: Record<string, string> = {
  alluring: "fitted, a little daring, with confident lines",
  romantic: "soft and romantic",
  confident: "sharp and confident",
  relaxed: "relaxed and easy",
  bold: "bold, with a statement",
  playful: "playful and light",
  minimal: "clean and minimal",
  elegant: "elegant and polished",
  sporty: "sporty and ready to move",
};

export function demoSuggest(
  prompt: string,
  limit = 3,
  opts: { hour?: number | null; anchorId?: string | null } = {},
): StyleSuggestResult {
  const intent = normalizeIntent(prompt, opts.hour ?? null);
  const items = demoWardrobe();
  const anchor = opts.anchorId ? items.find((i) => i.id === opts.anchorId) : undefined;
  const bySlot = (slot: Slot) => {
    const ranked = items
      .filter((i) => slotOf(i) === slot)
      .map((i) => ({ i, s: itemScore(i, intent) }))
      .sort((a, b) => b.s - a.s);
    // A piece the owner just added goes first in its slot.
    if (anchor && slotOf(anchor) === slot) ranked.sort((a, b) => Number(b.i.id === anchor.id) - Number(a.i.id === anchor.id));
    return ranked;
  };

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

  const wantsBag = ["evening", "date", "shopping"].includes(intent.occasion ?? "") || (intent.vibe === "alluring" && intent.time !== "day");
  const outfits = bases
    .map((base, idx) => {
      const pieces = [...base];
      const layer = anchor && slotOf(anchor) === "layer" ? layers[0] : layers[idx % Math.max(1, layers.length)];
      if (layer && (layer.s > 0.35 || layer.i.id === anchor?.id)) pieces.push(layer);
      if (intent.occasion !== "home") {
        const shoe = anchor && slotOf(anchor) === "shoes" ? shoes[0] : shoes[idx % Math.min(2, Math.max(1, shoes.length))];
        if (shoe) pieces.push(shoe);
      }
      const bag = bags[0];
      if (bag && (bag.i.id === anchor?.id || (wantsBag && bag.s > 0.3))) pieces.push(bag);
      const score = Math.min(0.99, pieces.reduce((a, p) => a + p.s, 0) / pieces.length + 0.35);
      return { pieces, score };
    })
    .filter(({ pieces }) => !anchor || pieces.some((p) => p.i.id === anchor.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const titles = TITLES[intent.vibe ?? ""] ?? TITLES[intent.occasion ?? ""] ?? TITLES.casual!;
  const occReason = intent.occasion ? REASONS[intent.occasion] : undefined;
  const vibeReason = intent.vibe ? VIBE_REASONS[intent.vibe] : undefined;
  const reason =
    occReason && vibeReason && !occReason.includes(vibeReason) && !vibeReason.includes(occReason) && !occReason.startsWith(vibeReason.split(" ")[0]!)
      ? `${vibeReason}, ${occReason}`
      : (occReason ?? vibeReason ?? "balanced and wearable");
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
      explanation: `${/^[aeiou]/.test(lead) ? "An" : "A"} ${lead} anchors the look${rest.length ? `, finished with ${rest.slice(0, -1).join(", ")}${rest.length > 1 ? " and " : ""}${rest.at(-1)}` : ""}: ${reason}.${colorNote}`,
    };
  });

  // Pieces asked for that the wardrobe does not have → what to shop for.
  const gaps = ["sneakers", "hat", "scarf", "sandals", "belt"]
    .filter((c) => new RegExp(`\\b${c}`).test(intent.raw.toLowerCase()) && !items.some((i) => i.category === c || i.subcategory === c))
    .map((c) => ({ slot: c, category: c, query: [intent.colors[0], c].filter(Boolean).join(" ") }));

  const partner = result[0]?.item_ids.map((id) => items.find((i) => i.id === id)).find((i) => i && i.id !== anchor?.id);
  const spoken = (i: WardrobeItem) => {
    const broad = ["top", "bottom", "outerwear", "accessory"].includes(i.category) && !i.subcategory;
    const plain = [i.color, i.subcategory ?? (broad ? "piece" : i.category)].filter(Boolean).join(" ");
    const name = i.metadata?.name;
    return (name && name.toLowerCase() !== i.category.toLowerCase() ? name : plain).toLowerCase();
  };
  const pairing_line = anchor
    ? partner
      ? `Nice, your new ${spoken(anchor)}. It works with your ${spoken(partner)}; want to see the whole look?`
      : `Nice, your new ${spoken(anchor)} is in your wardrobe.`
    : null;

  return {
    request_id: `demo_style_${stamp}`,
    normalized_intent: intent,
    outfits: result,
    gaps,
    question: clarification(prompt, intent),
    offer: offerFor(intent),
    pairing_line,
  };
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

// ---- Outfit sets and shopping (demo) ----

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const demoSets: OutfitSetView[] = [];

export function demoSetCreate(args: Record<string, unknown>): OutfitSetView {
  const kind = args.kind === "trip" ? "trip" : "week";
  const days = Math.max(1, Math.min(14, Number(args.days) || (kind === "week" ? 5 : 3)));
  const prompt = typeof args.prompt === "string" && args.prompt ? args.prompt : kind === "week" ? "office" : "travel";
  const outfits = demoSuggest(prompt, days).outfits;
  if (!outfits.length) throw new Error("Not enough pieces to plan outfits yet");
  const set: OutfitSetView = {
    id: `demo_set_${Date.now().toString(36)}`,
    kind,
    title: kind === "week" ? "This week" : `Trip · ${days} days`,
    created_at: new Date().toISOString(),
    looks: Array.from({ length: days }, (_, i) => {
      const o = outfits[i % outfits.length]!;
      return { label: kind === "week" ? WEEKDAYS[i % 7]! : `Day ${i + 1}`, item_ids: o.item_ids, explanation: o.explanation };
    }),
  };
  demoSets.unshift(set);
  if (demoSets.length > 10) demoSets.pop();
  return set;
}

export function demoSetList(): OutfitSetView[] {
  return demoSets;
}

export function demoSetDelete(args: Record<string, unknown>): { deleted: string } {
  const i = demoSets.findIndex((s) => s.id === args.set_id);
  if (i < 0) throw new Error("Set not found");
  demoSets.splice(i, 1);
  return { deleted: String(args.set_id) };
}

export function demoShopSuggest(args: Record<string, unknown>): ShopOffer[] {
  const query = [args.color, args.category].filter((v) => typeof v === "string" && v).join(" ").slice(0, 120);
  if (!query) throw new Error("category is required");
  return [
    {
      id: `demo_shop_${Date.now().toString(36)}`,
      title: `Search Amazon for “${query}”`,
      url: `https://www.amazon.com/s?${new URLSearchParams({ k: query })}`,
      provider: "amazon-linkout",
      query,
    },
  ];
}
