import { callTool, requireAccess, toErrorResponse } from "@/lib/server/backend";
import { issueTicket } from "@/lib/server/companion";
import { getConfig } from "@/lib/server/config";
import { TOOLS } from "@/lib/tools";

export const dynamic = "force-dynamic";

/**
 * Start a phone → screen photo hand-off. With a real backend the photo goes
 * to the owner's PC (SmartMirror capture session); the demo backend keeps the
 * same-browser channel.
 */
export async function POST(request: Request) {
  try {
    const config = getConfig();
    const session = await requireAccess(config);
    if (config.mode === "demo") return Response.json({ mode: "local" });
    const body = (await request.json().catch(() => ({}))) as { purpose?: unknown };
    const purpose = body.purpose === "garment" ? "garment" : "body";
    const created = (await callTool(TOOLS.captureSessionCreate, { purpose })) as { session_id: string; expires_at: string };
    return Response.json(
      {
        mode: "remote",
        sessionId: created.session_id,
        code: created.session_id.slice(-6).toUpperCase(),
        ticket: await issueTicket(created.session_id, session),
        expiresAt: created.expires_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
