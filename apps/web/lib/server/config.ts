import "server-only";

import type { BackendMode } from "@/lib/tools";

/**
 * Server-only configuration. Nothing here may use the NEXT_PUBLIC_ prefix:
 * those values are inlined into the browser bundle, and OllaBridge
 * credentials must never reach it.
 */
export interface ServerConfig {
  mode: BackendMode;
  profileId: string;
  sessionSecret: string | null;
  accessCode: string | null;
  smartmirrorApiUrl: string | null;
  ollabridge: {
    baseUrl: string | null;
    ownerToken: string | null;
    nodeId: string | null;
    mcpOperation: string;
    mcpServer: string;
    /** Code-entry pairing endpoint (3D Avatar style), relative to baseUrl. */
    pairingPath: string;
    /** Primary pairing flow shown on the screen. */
    pairingFlow: "device" | "code";
    /** Stylist persona model id; null = discover `persona:stylist--…`. */
    stylistModel: string | null;
  };
}

/** OllaBridge Cloud, the same default gateway the 3D Avatar Chatbot uses. */
export const DEFAULT_OLLABRIDGE_URL = "https://app.ollabridge.com";

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function trimSlash(url: string | null): string | null {
  return url ? url.replace(/\/+$/, "") : null;
}

export function getConfig(): ServerConfig {
  const ollabridge = {
    baseUrl: trimSlash(env("OLLABRIDGE_BASE_URL")),
    ownerToken: env("OLLABRIDGE_TOKEN"),
    nodeId: env("OLLABRIDGE_NODE_ID"),
    mcpOperation: env("OLLABRIDGE_MCP_OPERATION") ?? "agentic.invoke",
    mcpServer: env("OLLABRIDGE_MCP_SERVER") ?? "smartmirror",
    pairingPath: env("OLLABRIDGE_PAIRING_PATH") ?? "/pair",
    pairingFlow: env("OLLABRIDGE_PAIRING_FLOW") === "code" ? ("code" as const) : ("device" as const),
    stylistModel: env("OLLABRIDGE_STYLIST_MODEL"),
  };
  const smartmirrorApiUrl = trimSlash(env("SMARTMIRROR_API_URL"));

  const explicit = env("SMARTMIRROR_BACKEND");
  let mode: BackendMode;
  if (explicit === "demo" || explicit === "direct" || explicit === "ollabridge") {
    mode = explicit;
  } else if (ollabridge.baseUrl) {
    // Screens pair themselves (device flow or code), so a base URL is enough.
    mode = "ollabridge";
  } else if (smartmirrorApiUrl) {
    mode = "direct";
  } else if (env("VERCEL")) {
    // A Vercel deployment is the real product: screens pair with OllaBridge
    // Cloud. SMARTMIRROR_BACKEND=demo brings the sample wardrobe back.
    mode = "ollabridge";
  } else {
    mode = "demo"; // local development without any backend
  }

  if (mode === "ollabridge" && !ollabridge.baseUrl) ollabridge.baseUrl = DEFAULT_OLLABRIDGE_URL;

  return {
    mode,
    profileId: env("SMARTMIRROR_PROFILE_ID") ?? "local-user",
    sessionSecret: env("SMARTMIRROR_SESSION_SECRET"),
    accessCode: env("SMARTMIRROR_ACCESS_CODE"),
    smartmirrorApiUrl,
    ollabridge,
  };
}

/**
 * Single-owner deployment: the OllaBridge token lives in the server env and
 * screens unlock with SMARTMIRROR_ACCESS_CODE instead of pairing with OllaBridge.
 */
export function ownerMode(config: ServerConfig): boolean {
  return config.mode === "ollabridge" && Boolean(config.ollabridge.ownerToken && config.accessCode);
}

/** Real backends hold personal data, so they always require a paired session. */
export function pairingRequired(config: ServerConfig): boolean {
  if (config.mode === "ollabridge") return true;
  if (config.mode === "direct") return Boolean(config.accessCode);
  return false;
}
