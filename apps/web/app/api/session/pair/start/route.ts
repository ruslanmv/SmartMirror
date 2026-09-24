import { toErrorResponse } from "@/lib/server/backend";
import { getConfig, ownerMode } from "@/lib/server/config";
import { PairingError, platformFor, startDevicePairing, writePending } from "@/lib/server/pairing";
import { clientKey, createThrottle } from "@/lib/server/throttle";

export const dynamic = "force-dynamic";

const throttled = createThrottle(20, 10 * 60 * 1000);
const DEMO_TTL_SECONDS = 600;
const DEMO_APPROVE_AFTER_MS = 6_000;

/**
 * Start TV-style pairing: returns the code to show and the confirmation URL
 * (for the QR code). The secret device_code stays in a sealed HttpOnly cookie.
 */
export async function POST(request: Request) {
  try {
    if (throttled(clientKey(request))) {
      return Response.json({ error: "Too many attempts. Try again in a few minutes.", code: "throttled" }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { deviceName?: unknown; runtime?: unknown };
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 64) : "SmartMirror screen";
    const platform = platformFor(body.runtime);
    const config = getConfig();
    const now = Math.floor(Date.now() / 1000);

    if (config.mode === "ollabridge" && !ownerMode(config)) {
      const start = await startDevicePairing();
      await writePending({ deviceCode: start.deviceCode, platform, deviceName, exp: now + start.expiresIn });
      return Response.json(
        { userCode: start.userCode, verificationUrl: start.verificationUrl, expiresIn: start.expiresIn, interval: 5 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (config.mode === "demo") {
      // Exercises the whole flow without OllaBridge: approves itself shortly.
      await writePending({ deviceCode: "demo", platform, deviceName, exp: now + DEMO_TTL_SECONDS, approveAt: Date.now() + DEMO_APPROVE_AFTER_MS });
      return Response.json(
        { userCode: "DEMO-2026", verificationUrl: "https://app.ollabridge.com/link", expiresIn: DEMO_TTL_SECONDS, interval: 2, demo: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json({ error: "Show-a-code pairing needs the OllaBridge backend", code: "misconfigured" }, { status: 501 });
  } catch (err) {
    if (err instanceof PairingError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    return toErrorResponse(err);
  }
}
