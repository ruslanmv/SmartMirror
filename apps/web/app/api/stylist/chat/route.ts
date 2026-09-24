import { ollabridgeToken, requireAccess, toErrorResponse } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import {
  StylistError,
  buildMessages,
  chatCompletion,
  demoReply,
  isPersonaModel,
  listPersonas,
  pickStylist,
  type ChatTurn,
  type GroundingItem,
} from "@/lib/server/stylist";
import { clientKey, createThrottle } from "@/lib/server/throttle";

export const dynamic = "force-dynamic";
// Relay-routed persona chat can take a while on a home PC.
export const maxDuration = 60;

const throttled = createThrottle(40, 10 * 60 * 1000);

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function parseItems(v: unknown): GroundingItem[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = str(r.id, 64);
    const name = str(r.name, 80);
    if (!id || !name) return [];
    return [{ id, name, category: str(r.category, 40) ?? undefined, color: str(r.color, 40) ?? undefined }];
  });
}

function parseHistory(v: unknown): ChatTurn[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-6).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const content = str(r.content, 1000);
    return (r.role === "user" || r.role === "assistant") && content ? [{ role: r.role, content }] : [];
  });
}

/**
 * Ask the owner's HomePilot Stylist persona. Body:
 *   { prompt, items?: [{id, name, category?, color?}], history?: [{role, content}], model? }
 * `items` are the owned pieces the wardrobe tools chose; they become the
 * persona's "Owned items" grounding block.
 */
export async function POST(request: Request) {
  try {
    if (throttled(clientKey(request))) {
      return Response.json({ error: "Too many questions at once. Try again in a minute.", code: "throttled" }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const prompt = str(body.prompt, 500);
    if (!prompt) return Response.json({ error: "Ask your stylist something", code: "bad_request" }, { status: 400 });
    const items = parseItems(body.items);
    const history = parseHistory(body.history);

    const config = getConfig();
    const session = await requireAccess(config);

    if (config.mode === "demo") {
      return Response.json({ reply: demoReply(prompt, items), persona: { id: "demo:stylist", name: "Stylist (demo)" }, grounded: items.length > 0 });
    }
    if (config.mode !== "ollabridge") {
      return Response.json({ error: "The stylist persona needs the OllaBridge backend", code: "unavailable" }, { status: 501 });
    }

    const token = ollabridgeToken(config, session);
    const baseUrl = config.ollabridge.baseUrl!;
    const preferred = isPersonaModel(body.model) ? body.model : config.ollabridge.stylistModel;
    const personas = await listPersonas(baseUrl, token);
    const persona = pickStylist(personas, preferred);
    if (!persona) {
      throw new StylistError(
        "No Stylist persona is published on your HomePilot. Import stylist.hpersona and publish it with the alias “stylist”.",
        404,
        "no_persona",
      );
    }
    const reply = await chatCompletion(baseUrl, token, persona.id, buildMessages(prompt, items, history));
    return Response.json({ reply, persona, grounded: items.length > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof StylistError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    return toErrorResponse(err);
  }
}
