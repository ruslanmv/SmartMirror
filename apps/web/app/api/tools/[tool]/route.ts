import { callTool, toErrorResponse } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request, ctx: RouteContext<"/api/tools/[tool]">) {
  try {
    const { tool } = await ctx.params;
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Request too large", code: "too_large" }, { status: 413 });
    }
    const args = text ? JSON.parse(text) : {};
    const result = await callTool(decodeURIComponent(tool), args);
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof SyntaxError) return Response.json({ error: "Invalid JSON", code: "bad_json" }, { status: 400 });
    return toErrorResponse(err);
  }
}
