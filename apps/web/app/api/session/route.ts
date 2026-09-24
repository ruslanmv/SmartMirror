import { getConfig, pairingRequired } from "@/lib/server/config";
import { toErrorResponse } from "@/lib/server/backend";
import { clearSession, readSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Session status for the UI. Never returns the token itself. */
export async function GET() {
  try {
    const config = getConfig();
    const session = await readSession();
    return Response.json(
      {
        backend: config.mode,
        pairingRequired: pairingRequired(config),
        paired: Boolean(session),
        session: session
          ? { kind: session.kind, deviceName: session.deviceName ?? null, nodeId: session.nodeId ?? null, expiresAt: session.exp }
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
