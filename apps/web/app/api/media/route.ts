import { requireAccess, toErrorResponse } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import { OllaBridgeClient } from "@/lib/server/ollabridge";

export const dynamic = "force-dynamic";

// Stay under the Vercel Functions request body limit (4.5 MB).
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Relay a body capture to OllaBridge's temporary media store so HomePilot can
 * fetch it. The image is streamed through and never persisted or logged here.
 */
export async function POST(request: Request) {
  try {
    const config = getConfig();
    const session = await requireAccess(config);
    const body = (await request.json().catch(() => null)) as { dataUrl?: unknown } | null;
    const match = typeof body?.dataUrl === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.dataUrl) : null;
    if (!match) return Response.json({ error: "Expected a base64 image data URL", code: "bad_image" }, { status: 400 });

    const bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
    if (bytes.byteLength > MAX_BYTES) {
      return Response.json({ error: "Image is too large", code: "too_large" }, { status: 413 });
    }
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex").slice(0, 24);

    if (config.mode !== "ollabridge") {
      // Demo and direct modes keep the photo on the device; only a reference is exchanged.
      return Response.json({ ref: `local-capture:${digest}`, stored: false });
    }

    const token =
      session?.kind === "device" && session.deviceToken ? session.deviceToken : config.ollabridge.ownerToken;
    if (!token) return Response.json({ error: "Pair this screen to continue", code: "pairing_required" }, { status: 401 });
    const client = new OllaBridgeClient(config.ollabridge.baseUrl!, token, 30_000);
    const uploaded = await client.uploadMedia(`capture-${digest}.jpg`, bytes, match[1]!);
    const ref = [uploaded.media_id, uploaded.id, uploaded.ref, uploaded.url].find((v): v is string => typeof v === "string");
    return Response.json({ ref: ref ?? `ollabridge-media:${digest}`, stored: true, expiresAt: uploaded.expires_at ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
