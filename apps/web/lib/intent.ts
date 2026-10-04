import lexicon from "@smartmirror/contracts/stylist-lexicon.json";

/**
 * How the stylist reads a request: occasion × vibe, with the time of day
 * (docs/ux/stylist-conversation-review.md). Mirrors
 * smartmirror/stylist/engine.parse_intent; both are tested against
 * packages/contracts/stylist-intents.json, so the demo and the owner's PC agree.
 */

export interface StylistIntent {
  occasion: string | null;
  vibe: string | null;
  time: "evening" | "day" | null;
  question: "day_or_night" | null;
}

interface Entry {
  id: string;
  words: string[];
  vibe?: string;
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, words: string[]) => words.some((w) => new RegExp(`(?<![\\w'])${escape(w)}(?![\\w'])`).test(text));
const first = (text: string, entries: Entry[]) => entries.find((e) => has(text, e.words)) ?? null;

export function isEveningHour(hour: number | null | undefined): boolean {
  return hour != null && (hour >= lexicon.evening_from_hour || hour < lexicon.evening_until_hour);
}

export function parseIntent(prompt: string, hour: number | null = null): StylistIntent {
  const text = prompt.toLowerCase().replace(/’/g, "'");
  const occ = first(text, lexicon.occasions as Entry[]);
  const vibeEntry = first(text, lexicon.vibes as Entry[]);
  let occasion = occ?.id ?? null;
  const vibe = vibeEntry?.id ?? occ?.vibe ?? null;

  let time: StylistIntent["time"] = has(text, lexicon.times.evening) ? "evening" : has(text, lexicon.times.day) ? "day" : null;
  let question: StylistIntent["question"] = null;
  if (occasion === null && vibe !== null) {
    if (time === null) {
      if (isEveningHour(hour)) time = "evening";
      else if (/\bday\b/.test(text)) time = "day";
    }
    if (time === "evening") occasion = vibe === "romantic" ? "date" : "evening";
    else if (time === null && vibe === "alluring") question = "day_or_night";
  } else if (occasion === null && time === "evening") {
    occasion = "evening";
  }
  return { occasion, vibe, time, question };
}

export interface StylistQuestion {
  id: string;
  text: string;
  options: { label: string; prompt: string }[];
}

export function clarification(prompt: string, intent: StylistIntent): StylistQuestion | null {
  if (intent.question !== "day_or_night") return null;
  const base = prompt.trim();
  return {
    id: "day_or_night",
    text: "Day or night?",
    options: [
      { label: "Daytime", prompt: `${base} daytime` },
      { label: "Tonight", prompt: `${base} tonight` },
    ],
  };
}

export function offerFor(intent: StylistIntent): { id: string; text: string; label: string } | null {
  return intent.occasion === "shopping"
    ? { id: "gaps", text: "Want me to list what your wardrobe is missing?", label: "What am I missing?" }
    : null;
}
