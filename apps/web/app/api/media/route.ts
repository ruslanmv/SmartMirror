import { callTool, requireAccess, toErrorResponse } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import { TOOLS } from "@/lib/tools";

export const dynamic = "force-dynamic";

// The screen downscales before sending; this keeps a photo well inside the
// OllaBridge relay frame and the Vercel request body limit.
const MAX_DATA_URL = 1_200_000;

/**
 * Store a body capture for try-on. With a real backend it goes straight to
 * the owner's PC (SmartMirror capture_upload: EXIF removed, expires after
 * SMARTMIRROR_BODY_CAPTURE_TTL_HOURS) and never sits in a cloud media cache.
 * The demo backend keeps the photo on the device and exchanges a reference.
 */
export async function POST(request: Request) {
  try {
    const config = getConfig();
    await requireAccess(config);
    const body = (await request.json().catch(() => null)) as { dataUrl?: unknown } | null;
    const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
    if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl)) {
      return Response.json({ error: "Expected a base64 image data URL", code: "bad_image" }, { status: 400 });
    }
    if (dataUrl.length > MAX_DATA_URL) return Response.json({ error: "Image is too large", code: "too_large" }, { status: 413 });

    if (config.mode === "demo") {
      const bytes = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
      const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex").slice(0, 24);
      return Response.json({ ref: `local-capture:${digest}`, stored: false });
    }

    const stored = (await callTool(TOOLS.captureUpload, { image: dataUrl, purpose: "body" })) as {
      asset_id: string;
      expires_at?: string | null;
    };
    return Response.json({ ref: stored.asset_id, stored: true, expiresAt: stored.expires_at ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
