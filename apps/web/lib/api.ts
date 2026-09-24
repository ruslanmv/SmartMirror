"use client";

import type { DeviceCapabilities } from "@smartmirror/device-capabilities";

import {
  TOOLS,
  type HealthReport,
  type JobStatus,
  type NewWardrobeItem,
  type StyleSuggestResult,
  type TryOnCreated,
  type WardrobeItem,
} from "./tools";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
  get needsPairing() {
    return this.code === "pairing_required";
  }
  get offline() {
    return this.code === "offline";
  }
}

/**
 * Connectivity the simulator can force off. Real deployments get these from
 * /api/health; the simulator overrides them to test offline states.
 */
let connectivity: Pick<DeviceCapabilities, "ollabridgeOnline" | "homepilotOnline"> = {
  ollabridgeOnline: true,
  homepilotOnline: true,
};

export function setSimulatedConnectivity(value: typeof connectivity) {
  connectivity = value;
}

function assertOnline() {
  if (!connectivity.ollabridgeOnline) throw new ApiError("OllaBridge is unreachable", 503, "offline");
  if (!connectivity.homepilotOnline) throw new ApiError("Your HomePilot is offline", 503, "offline");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  } catch {
    throw new ApiError("Network unavailable", 0, "offline");
  }
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.code ?? "error");
  return (body.result ?? body) as T;
}

export async function callTool<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  assertOnline();
  return request<T>(`/api/tools/${encodeURIComponent(tool)}`, { method: "POST", body: JSON.stringify(args) });
}

export const api = {
  wardrobe: () => callTool<WardrobeItem[]>(TOOLS.wardrobeList),
  addItem: (item: NewWardrobeItem) => callTool<WardrobeItem>(TOOLS.wardrobeAdd, { ...item }),
  suggest: (prompt: string, limit = 3) => callTool<StyleSuggestResult>(TOOLS.styleSuggest, { prompt, limit }),
  createTryOn: (outfitId: string, bodyCaptureRef: string, instruction = "") =>
    callTool<TryOnCreated>(TOOLS.tryonCreate, { outfit_id: outfitId, body_capture_ref: bodyCaptureRef, instruction }),
  job: (jobId: string) => callTool<JobStatus>(TOOLS.jobGet, { job_id: jobId }),
  uploadCapture: (dataUrl: string) => {
    assertOnline();
    return request<{ ref: string; stored: boolean }>("/api/media", { method: "POST", body: JSON.stringify({ dataUrl }) });
  },
  health: () => request<HealthReport>("/api/health"),
  session: () =>
    request<{
      backend: HealthReport["backend"];
      pairingRequired: boolean;
      paired: boolean;
      session: { kind: string; deviceName: string | null; nodeId: string | null; expiresAt: number } | null;
    }>("/api/session"),
  pair: (code: string, deviceName: string) =>
    request<{ ok: true; kind: string }>("/api/session/pair", { method: "POST", body: JSON.stringify({ code, deviceName }) }),
  unpair: () => request<{ ok: true }>("/api/session", { method: "DELETE" }),
};
