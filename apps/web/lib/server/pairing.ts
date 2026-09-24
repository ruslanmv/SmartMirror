import "server-only";

import { cookies } from "next/headers";

import { APP_VERSION } from "@/lib/version";

import { getConfig } from "./config";
import { openSealed, seal } from "./seal";
import { sessionSecret } from "./session";

/**
 * Pairing with OllaBridge Cloud, the same way the 3D Avatar Chatbot pairs:
 *
 *   device flow (TV style)  POST /device/start → show ABCD-1234 + QR
 *                           POST /device/poll  → device_token once the owner confirms
 *   code entry              POST /pair {code, label, client} → {ok, token, device_id}
 *
 * The device_code (a secret) and the device token never reach the browser:
 * the pending pairing lives in a short-lived sealed HttpOnly cookie, and the
 * token is sealed into the session cookie.
 */

export type ClientPlatform = "android" | "other";

/** How the screen identifies itself to OllaBridge (shown in its dashboard). */
export function clientBlock(platform: ClientPlatform) {
  return { name: "SmartMirror", version: APP_VERSION, platform, vendor: "ruslanmv" };
}

/** OllaBridge Cloud maps this User-Agent prefix to "SmartMirror" (KNOWN_CLIENTS). */
export const USER_AGENT = `smartmirror/${APP_VERSION}`;

export function platformFor(runtime: unknown): ClientPlatform {
  return runtime === "echo-shell" || runtime === "alexa-html" ? "android" : "other";
}

export class PairingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "bad_code" | "rejected" | "expired" | "upstream" | "misconfigured",
  ) {
    super(message);
  }
}

/** OllaBridge codes are ABCD-1234; accept any spacing, dashes or case. */
export function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]+/g, "").toUpperCase();
  return /^[A-Z]{4}[0-9]{4}$/.test(code) ? code : null;
}

export function formatUserCode(code: string): string {
  const c = code.replace(/[\s-]+/g, "").toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export interface PairResult {
  token: string;
  deviceId: string | null;
}

/**
 * Accept both OllaBridge response shapes:
 *   /pair              {ok, token, device_id} | {ok: false, error}
 *   /device/pair-simple {status: "ok", device_token, device_id} | {status: "error", error}
 * /pair answers HTTP 200 even when it refuses, so the body decides.
 */
export function parsePairResponse(data: unknown): PairResult | { error: string } {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const token = [d.token, d.device_token].find((t): t is string => typeof t === "string" && t.length > 0);
  const refused = d.ok === false || d.status === "error";
  if (token && !refused) {
    return { token, deviceId: typeof d.device_id === "string" ? d.device_id : null };
  }
  return { error: typeof d.error === "string" && d.error ? d.error.slice(0, 200) : "That code was not accepted" };
}

async function post(path: string, body: unknown): Promise<Response> {
  const { ollabridge } = getConfig();
  if (!ollabridge.baseUrl) throw new PairingError("OllaBridge is not configured", 501, "misconfigured");
  const res = await fetch(`${ollabridge.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new PairingError("OllaBridge is unreachable. Check the connection and try again.", 503, "upstream");
  return res;
}

/** Code-entry pairing (3D Avatar style). */
export async function pairWithCode(code: string, platform: ClientPlatform): Promise<PairResult> {
  const { ollabridge } = getConfig();
  const res = await post(ollabridge.pairingPath, { code, label: "SmartMirror", client: clientBlock(platform) });
  if (res.status >= 500) throw new PairingError("OllaBridge is having trouble. Try again in a moment.", 503, "upstream");
  const parsed = parsePairResponse(await res.json().catch(() => ({})));
  if ("error" in parsed) throw new PairingError(parsed.error, 401, "rejected");
  return parsed;
}

export interface DeviceStart {
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  deviceCode: string;
}

export function parseDeviceStart(data: unknown): DeviceStart | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof d.user_code !== "string" || typeof d.device_code !== "string") return null;
  const expiresIn = typeof d.expires_in === "number" && d.expires_in > 0 ? d.expires_in : 600;
  const verificationUrl = typeof d.verification_url === "string" && /^https?:\/\//.test(d.verification_url)
    ? d.verification_url
    : `${getConfig().ollabridge.baseUrl}/link`;
  return { userCode: formatUserCode(d.user_code), verificationUrl, expiresIn, deviceCode: d.device_code };
}

export async function startDevicePairing(): Promise<DeviceStart> {
  const res = await post("/device/start", {});
  if (!res.ok) throw new PairingError("OllaBridge could not start pairing. Try again in a moment.", 503, "upstream");
  const start = parseDeviceStart(await res.json().catch(() => null));
  if (!start) throw new PairingError("OllaBridge returned an unexpected pairing response", 502, "upstream");
  return start;
}

export type PollOutcome = { status: "pending" } | { status: "expired" } | ({ status: "approved" } & PairResult);

export function parseDevicePoll(httpStatus: number, data: unknown): PollOutcome {
  if (httpStatus === 404) return { status: "expired" }; // unknown device_code
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (d.status === "approved" && typeof d.device_token === "string" && d.device_token) {
    return { status: "approved", token: d.device_token, deviceId: typeof d.device_id === "string" ? d.device_id : null };
  }
  // "approved" without a token means it was already issued to an earlier poll.
  if (d.status === "expired" || d.status === "approved") return { status: "expired" };
  return { status: "pending" };
}

export async function pollDevicePairing(deviceCode: string, platform: ClientPlatform): Promise<PollOutcome> {
  // `client` names the device "SmartMirror" (OllaBridge Cloud OB-3); older
  // gateways ignore the field and the device is named "My PC".
  const res = await post("/device/poll", { device_code: deviceCode, client: clientBlock(platform) });
  if (res.status >= 500) throw new PairingError("OllaBridge is having trouble. Still trying…", 503, "upstream");
  return parseDevicePoll(res.status, await res.json().catch(() => ({})));
}

// ---- Pending device pairing (sealed, HttpOnly, short-lived) ----

export const PENDING_COOKIE = "sm_pairing";

export interface PendingPairing {
  v: 1;
  /** OllaBridge device_code, or "demo" for the demo backend. */
  deviceCode: string;
  platform: ClientPlatform;
  deviceName: string;
  exp: number;
  /** Demo backend only: auto-approve after this time (ms). */
  approveAt?: number;
}

export async function writePending(p: Omit<PendingPairing, "v">): Promise<void> {
  const data: PendingPairing = { ...p, v: 1 };
  const maxAge = Math.max(1, p.exp - Math.floor(Date.now() / 1000));
  (await cookies()).set(PENDING_COOKIE, await seal(data, sessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/session/pair",
    maxAge,
  });
}

export async function readPending(): Promise<PendingPairing | null> {
  const raw = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!raw) return null;
  const data = await openSealed<PendingPairing>(raw, sessionSecret());
  if (!data || data.v !== 1 || data.exp * 1000 < Date.now()) return null;
  return data;
}

export async function clearPending(): Promise<void> {
  (await cookies()).delete({ name: PENDING_COOKIE, path: "/api/session/pair" });
}
