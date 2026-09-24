import "server-only";

import { cookies } from "next/headers";

import { getConfig } from "./config";
import { openSealed, seal } from "./seal";

/**
 * Browser sessions are an encrypted, HttpOnly cookie. The browser never sees
 * an OllaBridge credential: in "owner" mode the token stays in a server env
 * var, and in "device" mode the per-device token lives only inside the sealed
 * cookie, which JavaScript cannot read.
 */
export interface SessionData {
  v: 1;
  kind: "owner" | "device" | "demo";
  /** OllaBridge device token (device mode only). */
  deviceToken?: string;
  nodeId?: string;
  deviceName?: string;
  iat: number;
  exp: number;
}

export const SESSION_COOKIE = "sm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

// Demo deployments work without configuration; their sessions only need to
// survive the life of one server instance.
let ephemeralSecret: string | null = null;

export class SessionConfigError extends Error {}

function secret(): string {
  const config = getConfig();
  if (config.sessionSecret) {
    if (config.sessionSecret.length < 32) {
      throw new SessionConfigError("SMARTMIRROR_SESSION_SECRET must be at least 32 characters");
    }
    return config.sessionSecret;
  }
  if (config.mode !== "demo") {
    throw new SessionConfigError("SMARTMIRROR_SESSION_SECRET is required when a real backend is configured");
  }
  ephemeralSecret ??= crypto.randomUUID() + crypto.randomUUID();
  return ephemeralSecret;
}

export async function readSession(): Promise<SessionData | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const data = await openSealed<SessionData>(raw, secret());
  if (!data || data.v !== 1 || data.exp * 1000 < Date.now()) return null;
  return data;
}

export async function writeSession(input: Omit<SessionData, "v" | "iat" | "exp">): Promise<SessionData> {
  const now = Math.floor(Date.now() / 1000);
  const data: SessionData = { ...input, v: 1, iat: now, exp: now + SESSION_TTL_SECONDS };
  (await cookies()).set(SESSION_COOKIE, await seal(data, secret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return data;
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
