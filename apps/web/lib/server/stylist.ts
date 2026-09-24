import "server-only";

import { USER_AGENT } from "./pairing";

/**
 * Stylist chat on OllaBridge's chat plane (Plane A), exactly like the 3D Avatar
 * Chatbot: OpenAI-compatible /v1/chat/completions with a HomePilot persona
 * model (`persona:stylist--<id>`). The persona brings its own system prompt;
 * SmartMirror only adds an "Owned items" grounding block when the wardrobe
 * tools returned outfits, so the persona never invents clothes.
 */

export const CLIENT_TYPE = "smart-mirror";
const CHAT_TIMEOUT_MS = 45_000;
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [600, 1500];

export interface GroundingItem {
  id: string;
  name: string;
  category?: string;
  color?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PersonaModel {
  id: string;
  name: string;
}

export class StylistError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "no_persona" | "upstream" | "timeout" | "pairing_required" | "bad_request",
  ) {
    super(message);
  }
}

/** Only HomePilot persona models may be addressed from the screen. */
export function isPersonaModel(id: unknown): id is string {
  return typeof id === "string" && /^(persona|personality):[A-Za-z0-9._:-]{1,120}$/.test(id);
}

export function parseModels(data: unknown): PersonaModel[] {
  const list = Array.isArray((data as { data?: unknown })?.data) ? (data as { data: unknown[] }).data : [];
  return list
    .map((m) => m as { id?: unknown; name?: unknown })
    .filter((m): m is { id: string; name?: unknown } => isPersonaModel(m.id))
    .map((m) => ({ id: m.id, name: typeof m.name === "string" && m.name ? m.name : m.id }));
}

/** Explicit choice (if still published) → persona:stylist… → any "stylist" persona. */
export function pickStylist(models: PersonaModel[], preferred?: string | null): PersonaModel | null {
  if (preferred) {
    const hit = models.find((m) => m.id === preferred);
    if (hit) return hit;
  }
  return (
    models.find((m) => /^persona:stylist(--|$)/.test(m.id)) ??
    models.find((m) => /stylist/i.test(m.id) || /stylist/i.test(m.name)) ??
    null
  );
}

export function groundingBlock(items: GroundingItem[]): string | null {
  if (!items.length) return null;
  const lines = items.map((it) => {
    const details = [it.category, it.color].filter(Boolean).join(", ");
    return `- ${it.name}${details ? ` (${details})` : ""}`;
  });
  return `Owned items (recommend only these; they are what the owner has):\n${lines.join("\n")}`;
}

export function buildMessages(prompt: string, items: GroundingItem[], history: ChatTurn[]) {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  const block = groundingBlock(items);
  // A remote persona keeps its own system prompt (3D Avatar rule); this only adds context.
  if (block) messages.push({ role: "system", content: block });
  messages.push(...history.slice(-6));
  messages.push({ role: "user", content: prompt });
  return messages;
}

export function replyText(data: unknown): string | null {
  const choice = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-Client-Type": CLIENT_TYPE,
  };
}

export async function listPersonas(baseUrl: string, token: string): Promise<PersonaModel[]> {
  const res = await fetch(`${baseUrl}/v1/models`, {
    headers: headers(token),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new StylistError("OllaBridge is unreachable", 503, "upstream");
  if (res.status === 401 || res.status === 403) throw new StylistError("Pair this screen again", 401, "pairing_required");
  if (!res.ok) throw new StylistError("OllaBridge could not list your personas", 502, "upstream");
  return parseModels(await res.json().catch(() => null));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Non-streaming chat: OllaBridge answers relay-routed streaming with 501.
 * The relayed chat path is the one that flakes (measured by the 3D Avatar),
 * so 502/503/504 are retried twice with backoff.
 */
export async function chatCompletion(
  baseUrl: string,
  token: string,
  model: string,
  messages: ReturnType<typeof buildMessages>,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<string> {
  const body = JSON.stringify({ model, messages, stream: false, temperature: 0.7, max_tokens: 220 });
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: headers(token),
        body,
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (timedOut) throw new StylistError("Your home PC did not answer in time. Is HomePilot running?", 504, "timeout");
      if (attempt >= delays.length) throw new StylistError("OllaBridge is unreachable", 503, "upstream");
      await sleep(delays[attempt]!);
      continue;
    }
    if (res.ok) {
      const text = replyText(await res.json().catch(() => null));
      if (!text) throw new StylistError("Your stylist sent an empty answer", 502, "upstream");
      return text;
    }
    if (res.status === 401 || res.status === 403) throw new StylistError("Pair this screen again", 401, "pairing_required");
    if (res.status === 404) throw new StylistError("Your stylist persona is not published on HomePilot", 404, "no_persona");
    if (RETRY_STATUSES.has(res.status) && attempt < delays.length) {
      await sleep(delays[attempt]!);
      continue;
    }
    throw new StylistError(
      res.status === 504 ? "Your home PC did not answer in time. Is HomePilot running?" : "Your stylist is unavailable right now",
      res.status === 504 ? 504 : 502,
      res.status === 504 ? "timeout" : "upstream",
    );
  }
}

/** Demo backend: a short, speakable answer built only from the grounding items. */
export function demoReply(prompt: string, items: GroundingItem[]): string {
  if (!items.length) {
    return "Tell me the occasion and I'll pull a complete look from your wardrobe. Start with one piece you love and build around it.";
  }
  const [a, b, c] = items;
  const names = [a, b, c].filter(Boolean).map((i) => i!.name.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const occasion = /dinner|date|party|cocktail|wedding/i.test(prompt)
    ? "It reads polished for the evening."
    : /office|work|meeting/i.test(prompt)
      ? "It's sharp enough for work and still comfortable."
      : "It's easy, balanced and ready to go.";
  return `Go with the ${list}. ${occasion}`;
}
