import { callTool, toErrorResponse } from "@/lib/server/backend";
import { TOOLS } from "@/lib/tools";

export const dynamic = "force-dynamic";

/** The screen polls its capture session; returns a small preview once the photo arrived. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    if (typeof body.sessionId !== "string" || !/^cap_[a-f0-9]{32}$/.test(body.sessionId)) {
      return Response.json({ error: "Unknown capture session", code: "bad_request" }, { status: 400 });
    }
    const status = await callTool(TOOLS.captureSessionGet, { session_id: body.sessionId });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
