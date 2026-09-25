import { callToolAs, toErrorResponse } from "@/lib/server/backend";
import { openTicket } from "@/lib/server/companion";
import { clientKey, createThrottle } from "@/lib/server/throttle";
import { TOOLS } from "@/lib/tools";

export const dynamic = "force-dynamic";

// A downscaled phone photo; stays well under the OllaBridge relay frame limit.
const MAX_DATA_URL = 1_200_000;
const throttled = createThrottle(12, 10 * 60 * 1000);

/** The phone sends its photo with the sealed ticket from the screen's QR code. */
export async function POST(request: Request) {
  try {
    if (throttled(clientKey(request))) {
      return Response.json({ error: "Too many uploads. Try again in a few minutes.", code: "throttled" }, { status: 429 });
    }
    const body = (await request.json().catch(() => null)) as { ticket?: unknown; image?: unknown } | null;
    const ticket = await openTicket(body?.ticket);
    if (!ticket) {
      return Response.json({ error: "This link has expired. Scan the code on the mirror again.", code: "expired" }, { status: 401 });
    }
    const image = typeof body?.image === "string" ? body.image : "";
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return Response.json({ error: "Expected a photo", code: "bad_image" }, { status: 400 });
    }
    if (image.length > MAX_DATA_URL) return Response.json({ error: "Photo is too large", code: "too_large" }, { status: 413 });

    if (ticket.purpose === "garment") {
      // Closet scan: each photo becomes a draft garment in the review queue.
      const name = typeof (body as { name?: unknown }).name === "string" ? String((body as { name: string }).name).slice(0, 80) : undefined;
      const item = (await callToolAs(ticket.session, TOOLS.wardrobeIngest, { image, ...(name ? { name } : {}) })) as { id: string };
      return Response.json({ ok: true, itemId: item.id });
    }
    const uploaded = (await callToolAs(ticket.session, TOOLS.captureUpload, { image, purpose: "body" })) as { asset_id: string };
    await callToolAs(ticket.session, TOOLS.captureSessionComplete, { session_id: ticket.sid, asset_id: uploaded.asset_id });
    return Response.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
