import type { OutfitSetView, WardrobeItem } from "./tools";

/**
 * What the stylist knows about the day (docs/ux/stylist-conversation-review.md
 * §3.2): the date, the part of the day, today's look from a saved plan, and
 * pieces added this week. Built on the screen; sent per request, never stored.
 */

export interface DayContext {
  today?: string;
  partOfDay?: string;
  plan?: string;
  newPieces?: string[];
}

export interface DayIdea {
  label: string;
  prompt: string;
}

const NEW_PIECE_DAYS = 7;

export function partOfDayName(now: Date): "morning" | "afternoon" | "evening" | "night" {
  const h = now.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return h < 22 ? "evening" : "night";
}

export function weekdayName(now: Date): string {
  return now.toLocaleDateString("en-GB", { weekday: "long" });
}

const itemName = (i: WardrobeItem) => i.metadata?.name ?? [i.color, i.subcategory ?? i.category].filter(Boolean).join(" ");

/** Today's look from the newest week plan that has a day named like today. */
export function planForToday(sets: OutfitSetView[], items: WardrobeItem[], now: Date): { set: OutfitSetView; text: string } | null {
  const day = weekdayName(now);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const set of sets) {
    if (set.kind !== "week") continue;
    const look = set.looks.find((l) => l.label === day);
    if (!look) continue;
    const names = look.item_ids.map((id) => byId.get(id)).filter((i): i is WardrobeItem => Boolean(i)).map(itemName);
    if (names.length) return { set, text: `${set.title} · ${day}: ${names.join(", ")}` };
  }
  return null;
}

export function newPieces(items: WardrobeItem[], now: Date): WardrobeItem[] {
  const since = now.getTime() - NEW_PIECE_DAYS * 24 * 3600 * 1000;
  return items
    .filter((i) => i.created_at && Date.parse(i.created_at) >= since)
    .sort((a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!))
    .slice(0, 3);
}

export function dayContext(now: Date, sets: OutfitSetView[], items: WardrobeItem[]): DayContext {
  return {
    today: now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    partOfDay: partOfDayName(now),
    plan: planForToday(sets, items, now)?.text,
    newPieces: newPieces(items, now).map(itemName),
  };
}

const IDEAS: Record<string, DayIdea> = {
  work: { label: "Work day", prompt: "Work day" },
  interview: { label: "Interview", prompt: "Job interview, confident and sharp" },
  errands: { label: "Errands", prompt: "Easy outfit for errands" },
  love: { label: "Love day", prompt: "Love day, something romantic" },
  sexy: { label: "Sexy night", prompt: "Something sexy for tonight" },
  party: { label: "Party", prompt: "Bold party look for tonight" },
  shopping: { label: "Shopping day", prompt: "Shopping day" },
  brunch: { label: "Brunch", prompt: "Relaxed weekend brunch" },
  lazy: { label: "Lazy day", prompt: "Lazy day at home, cosy" },
  travel: { label: "Travel day", prompt: "Comfortable layers for a travel day" },
  dinner: { label: "Dinner", prompt: "Elegant dinner tonight" },
};

/** Home-screen ideas ordered by what this moment usually calls for. */
export function ideasFor(now: Date): DayIdea[] {
  const d = now.getDay(); // 0 Sunday … 6 Saturday
  const h = now.getHours();
  const weekend = d === 0 || d === 6;
  const evening = h >= 17 || h < 5;
  const nightOut = evening && (d === 5 || d === 6); // Friday and Saturday evenings
  const order = nightOut
    ? ["love", "sexy", "party", "dinner", "lazy"]
    : evening
      ? ["dinner", "love", "sexy", "lazy", "work"]
      : weekend
        ? ["shopping", "brunch", "lazy", "love", "travel"]
        : ["work", "interview", "errands", "shopping", "love"];
  return order.map((k) => IDEAS[k]!);
}
