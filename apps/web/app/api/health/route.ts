import { health, toErrorResponse } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await health(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
