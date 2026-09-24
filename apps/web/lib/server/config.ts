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
    pairingPath: string | null;
  };
}

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
    mcpOperation: env("OLLABRIDGE_MCP_OPERATION") ?? "mcp.tools_call",
    mcpServer: env("OLLABRIDGE_MCP_SERVER") ?? "smartmirror",
    pairingPath: env("OLLABRIDGE_PAIRING_PATH"),
  };
  const smartmirrorApiUrl = trimSlash(env("SMARTMIRROR_API_URL"));

  const explicit = env("SMARTMIRROR_BACKEND");
  let mode: BackendMode;
  if (explicit === "demo" || explicit === "direct" || explicit === "ollabridge") {
    mode = explicit;
  } else if (ollabridge.baseUrl && (ollabridge.ownerToken || ollabridge.pairingPath)) {
    mode = "ollabridge";
  } else if (smartmirrorApiUrl) {
    mode = "direct";
  } else {
    mode = "demo";
  }

  return {
    mode,
    profileId: env("SMARTMIRROR_PROFILE_ID") ?? "local-user",
    sessionSecret: env("SMARTMIRROR_SESSION_SECRET"),
    accessCode: env("SMARTMIRROR_ACCESS_CODE"),
    smartmirrorApiUrl,
    ollabridge,
  };
}

/** Real backends hold personal data, so they always require a paired session. */
export function pairingRequired(config: ServerConfig): boolean {
  if (config.mode === "ollabridge") return true;
  if (config.mode === "direct") return Boolean(config.accessCode);
  return false;
}
