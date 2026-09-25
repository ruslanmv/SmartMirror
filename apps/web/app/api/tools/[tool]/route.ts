import { callTool, toErrorResponse } from "@/lib/server/backend";
import { clientKey, createThrottle } from "@/lib/server/throttle";
import { TOOLS } from "@/lib/tools";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;

// Per screen (client address), per instance. The PC enforces its own limits too.
const anyTool = createThrottle(120, 60_000);
const expensive = createThrottle(10, 60_000);
const EXPENSIVE = new Set<string>([TOOLS.tryonCreate, TOOLS.setCreate, TOOLS.profileDelete]);

export async function POST(request: Request, ctx: RouteContext<"/api/tools/[tool]">) {
  try {
    const { tool } = await ctx.params;
    const name = decodeURIComponent(tool);
    const who = clientKey(request);
    if (anyTool(who) || (EXPENSIVE.has(name) && expensive(`${who}:${name}`))) {
      return Response.json(
        { error: "Too many requests. Wait a minute and try again.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Request too large", code: "too_large" }, { status: 413 });
    }
    const args = text ? JSON.parse(text) : {};
    const result = await callTool(name, args);
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof SyntaxError) return Response.json({ error: "Invalid JSON", code: "bad_json" }, { status: 400 });
    return toErrorResponse(err);
  }
}
