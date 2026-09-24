import { toErrorResponse } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import { safeEqual } from "@/lib/server/seal";
import { writeSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// Best-effort per-instance throttle; put a platform firewall rule in front for real limits.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function throttled(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

interface PairBody {
  code?: unknown;
  deviceName?: unknown;
}

/**
 * Exchange a short pairing code for an HttpOnly session.
 *
 *  - OLLABRIDGE_PAIRING_PATH set → the code is claimed at OllaBridge, which
 *    returns a per-device token; the token is sealed inside the cookie.
 *  - SMARTMIRROR_ACCESS_CODE set → single-owner deployments; the owner token
 *    stays in the server environment.
 *  - demo backend → any 6-digit code pairs, to exercise the flow.
 */
export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (throttled(ip)) {
      return Response.json({ error: "Too many attempts. Try again in a few minutes.", code: "throttled" }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as PairBody;
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "").toUpperCase() : "";
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 64) : "SmartMirror screen";
    if (!/^[0-9A-Z]{4,12}$/.test(code)) {
      return Response.json({ error: "Enter the pairing code shown in OllaBridge", code: "bad_code" }, { status: 400 });
    }

    const config = getConfig();

    if (config.mode === "ollabridge" && config.ollabridge.pairingPath && config.ollabridge.baseUrl) {
      const res = await fetch(`${config.ollabridge.baseUrl}${config.ollabridge.pairingPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, device_name: deviceName, device_type: "smartmirror-web" }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      }).catch(() => null);
      if (!res) return Response.json({ error: "OllaBridge is unreachable", code: "upstream" }, { status: 503 });
      if (!res.ok) return Response.json({ error: "That code was not accepted", code: "rejected" }, { status: 401 });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const token = [data.device_token, data.token, data.access_token].find((t): t is string => typeof t === "string");
      if (!token) return Response.json({ error: "OllaBridge returned no device token", code: "upstream" }, { status: 502 });
      const nodeId = typeof data.node_id === "string" ? data.node_id : undefined;
      await writeSession({ kind: "device", deviceToken: token, nodeId, deviceName });
      return Response.json({ ok: true, kind: "device" });
    }

    if (config.accessCode) {
      if (!safeEqual(code, config.accessCode.toUpperCase())) {
        return Response.json({ error: "That code was not accepted", code: "rejected" }, { status: 401 });
      }
      await writeSession({ kind: "owner", deviceName });
      return Response.json({ ok: true, kind: "owner" });
    }

    if (config.mode === "demo") {
      if (!/^\d{6}$/.test(code)) {
        return Response.json({ error: "Demo mode accepts any 6-digit code", code: "bad_code" }, { status: 400 });
      }
      await writeSession({ kind: "demo", deviceName });
      return Response.json({ ok: true, kind: "demo" });
    }

    return Response.json(
      { error: "Pairing is not configured on this deployment", code: "misconfigured" },
      { status: 501 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
