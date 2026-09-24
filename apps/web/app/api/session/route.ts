import { getConfig, ownerMode, pairingRequired, type ServerConfig } from "@/lib/server/config";
import { toErrorResponse } from "@/lib/server/backend";
import { clearSession, readSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Which pairing flows this deployment offers (never includes credentials). */
function pairingOptions(config: ServerConfig) {
  const owner = ownerMode(config);
  const device = (config.mode === "ollabridge" && !owner) || config.mode === "demo";
  const code =
    config.mode === "ollabridge" && !owner ? "ollabridge" : config.accessCode ? "access" : config.mode === "demo" ? "demo" : null;
  const gateway = config.mode === "ollabridge" && config.ollabridge.baseUrl ? new URL(config.ollabridge.baseUrl).host : null;
  return { device, code, primary: device ? config.ollabridge.pairingFlow : "code", gateway };
}

/** Session status for the UI. Never returns the token itself. */
export async function GET() {
  try {
    const config = getConfig();
    const session = await readSession();
    return Response.json(
      {
        backend: config.mode,
        pairingRequired: pairingRequired(config),
        pairing: pairingOptions(config),
        paired: Boolean(session),
        session: session
          ? {
              kind: session.kind,
              deviceName: session.deviceName ?? null,
              deviceId: session.deviceId ?? null,
              nodeId: session.nodeId ?? null,
              expiresAt: session.exp,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  await clearSession();
  return Response.json({ ok: true });
}
