import { toErrorResponse } from "@/lib/server/backend";
import { getConfig, ownerMode } from "@/lib/server/config";
import { PairingError, normalizeUserCode, pairWithCode, platformFor } from "@/lib/server/pairing";
import { safeEqual } from "@/lib/server/seal";
import { writeSession } from "@/lib/server/session";
import { clientKey, createThrottle } from "@/lib/server/throttle";

export const dynamic = "force-dynamic";

const throttled = createThrottle(10, 10 * 60 * 1000);

interface PairBody {
  code?: unknown;
  deviceName?: unknown;
  runtime?: unknown;
}

/**
 * Exchange a typed pairing code for an HttpOnly session.
 *
 *  - ollabridge backend (unless single-owner, below) → the dashboard code is claimed at
 *    `/pair` (as the 3D Avatar does); the device token is sealed in the cookie.
 *  - SMARTMIRROR_ACCESS_CODE set → single-owner deployments; the owner token
 *    stays in the server environment.
 *  - demo backend → any 6 digits or any ABCD-1234 code pairs.
 *
 * The TV-style flow (show a code, confirm on the phone) is ./start + ./poll.
 */
export async function POST(request: Request) {
  try {
    if (throttled(clientKey(request))) {
      return Response.json({ error: "Too many attempts. Try again in a few minutes.", code: "throttled" }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as PairBody;
    const raw = typeof body.code === "string" ? body.code.replace(/[\s-]+/g, "").toUpperCase() : "";
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 64) : "SmartMirror screen";
    const config = getConfig();

    if (config.mode === "ollabridge" && !ownerMode(config)) {
      const code = normalizeUserCode(raw);
      if (!code) {
        return Response.json({ error: "Enter the 8-character code from OllaBridge, like ABCD-1234", code: "bad_code" }, { status: 400 });
      }
      const { token, deviceId } = await pairWithCode(code, platformFor(body.runtime));
      await writeSession({ kind: "device", deviceToken: token, deviceId: deviceId ?? undefined, deviceName });
      return Response.json({ ok: true, kind: "device" });
    }

    if (!/^[0-9A-Z]{4,12}$/.test(raw)) {
      return Response.json({ error: "Enter the pairing code", code: "bad_code" }, { status: 400 });
    }

    if (config.accessCode) {
      if (!safeEqual(raw, config.accessCode.toUpperCase())) {
        return Response.json({ error: "That code was not accepted", code: "rejected" }, { status: 401 });
      }
      await writeSession({ kind: "owner", deviceName });
      return Response.json({ ok: true, kind: "owner" });
    }

    if (config.mode === "demo") {
      if (!/^\d{6}$/.test(raw) && !normalizeUserCode(raw)) {
        return Response.json({ error: "Demo mode accepts any 6 digits or any ABCD-1234 code", code: "bad_code" }, { status: 400 });
      }
      await writeSession({ kind: "demo", deviceName });
      return Response.json({ ok: true, kind: "demo" });
    }

    return Response.json(
      { error: "Pairing is not configured on this deployment", code: "misconfigured" },
      { status: 501 },
    );
  } catch (err) {
    if (err instanceof PairingError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    return toErrorResponse(err);
  }
}
