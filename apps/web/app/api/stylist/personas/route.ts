import { ollabridgeToken, requireAccess, toErrorResponse } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import { StylistError, listPersonas, pickStylist } from "@/lib/server/stylist";

export const dynamic = "force-dynamic";

/** Personas published on the owner's HomePilot, for Settings → Stylist. */
export async function GET() {
  try {
    const config = getConfig();
    const session = await requireAccess(config);
    if (config.mode === "demo") {
      const personas = [{ id: "demo:stylist", name: "Stylist (demo)" }];
      return Response.json({ personas, suggested: personas[0]!.id });
    }
    if (config.mode !== "ollabridge") return Response.json({ personas: [], suggested: null });
    const personas = await listPersonas(config.ollabridge.baseUrl!, ollabridgeToken(config, session));
    const suggested = pickStylist(personas, config.ollabridge.stylistModel)?.id ?? null;
    return Response.json({ personas, suggested }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof StylistError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    return toErrorResponse(err);
  }
}
