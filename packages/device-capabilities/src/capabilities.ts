/**
 * Device capability model shared by the web UI, the Vercel simulator and the
 * Echo Show Android shell. Every hardware feature is a capability check, never
 * an assumption: the UI must stay usable with all of them switched off.
 */

export interface DeviceCapabilities {
  /** Pointer/touch input. Off means the UI must be fully D-pad navigable. */
  touch: boolean;
  /** A camera the UI may use directly (browser getUserMedia or native CameraX). */
  camera: boolean;
  /** A microphone the UI may use directly (Web Speech or native AudioRecord). */
  microphone: boolean;
  /** Launched from an Alexa skill via Alexa.Presentation.HTML. */
  alexa: boolean;
  /** Remote control / arrow-key navigation is the primary input. */
  dpad: boolean;
  /** OllaBridge Cloud is reachable (simulated or probed). */
  ollabridgeOnline: boolean;
  /** The owner's HomePilot node is online behind OllaBridge. */
  homepilotOnline: boolean;
}

export type CapabilityKey = keyof DeviceCapabilities;

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  "touch",
  "camera",
  "microphone",
  "alexa",
  "dpad",
  "ollabridgeOnline",
  "homepilotOnline",
] as const;

export const CAPABILITY_LABELS: Record<CapabilityKey, { label: string; hint: string }> = {
  touch: { label: "Touch", hint: "Pointer and touch input" },
  camera: { label: "Camera", hint: "Direct camera capture" },
  microphone: { label: "Microphone", hint: "Direct voice input" },
  alexa: { label: "Alexa", hint: "Alexa.Presentation.HTML session" },
  dpad: { label: "D-pad", hint: "Remote / arrow-key navigation" },
  ollabridgeOnline: { label: "OllaBridge online", hint: "Cloud relay reachable" },
  homepilotOnline: { label: "HomePilot online", hint: "Home node connected" },
};

/** Where the UI is running. Determines which native bridges can exist. */
export type Runtime = "browser" | "simulator" | "echo-shell" | "alexa-html";

export interface Viewport {
  width: number;
  height: number;
}

export interface DeviceProfile {
  id: string;
  name: string;
  description: string;
  /** Fixed viewport, or null for responsive profiles. */
  viewport: Viewport | null;
  /** The runtime the simulator pretends to be. */
  runtime: Runtime;
  capabilities: DeviceCapabilities;
}

export const DEVICE_PROFILES = {
  "echo-show-21": {
    id: "echo-show-21",
    name: "Echo Show 21",
    description: "Conservative: 1920×1080 landscape, D-pad only, no direct camera or microphone.",
    viewport: { width: 1920, height: 1080 },
    runtime: "echo-shell",
    capabilities: {
      touch: false,
      camera: false,
      microphone: false,
      alexa: false,
      dpad: true,
      ollabridgeOnline: true,
      homepilotOnline: true,
    },
  },
  "echo-show-21-experimental": {
    id: "echo-show-21-experimental",
    name: "Echo Show 21 · experimental",
    description: "Optimistic: 1920×1080 with touch, native camera and microphone exposed to the shell.",
    viewport: { width: 1920, height: 1080 },
    runtime: "echo-shell",
    capabilities: {
      touch: true,
      camera: true,
      microphone: true,
      alexa: false,
      dpad: true,
      ollabridgeOnline: true,
      homepilotOnline: true,
    },
  },
  "echo-show-21-alexa": {
    id: "echo-show-21-alexa",
    name: "Echo Show 21 · Alexa skill",
    description: "Launched by the Alexa skill via Alexa.Presentation.HTML: touch and voice, camera only if the web camera is allowed.",
    viewport: { width: 1920, height: 1080 },
    runtime: "alexa-html",
    capabilities: {
      touch: true,
      camera: false,
      microphone: false,
      alexa: true,
      dpad: false,
      ollabridgeOnline: true,
      homepilotOnline: true,
    },
  },
  browser: {
    id: "browser",
    name: "Browser development",
    description: "Responsive layout with touch, browser camera and browser microphone.",
    viewport: null,
    runtime: "browser",
    capabilities: {
      touch: true,
      camera: true,
      microphone: true,
      alexa: false,
      dpad: false,
      ollabridgeOnline: true,
      homepilotOnline: true,
    },
  },
} as const satisfies Record<string, DeviceProfile>;

export type DeviceProfileId = keyof typeof DEVICE_PROFILES;

export function isDeviceProfileId(value: unknown): value is DeviceProfileId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEVICE_PROFILES, value);
}

export function getDeviceProfile(id: string | null | undefined): DeviceProfile | null {
  return isDeviceProfileId(id) ? DEVICE_PROFILES[id] : null;
}

/**
 * Encode capabilities as a compact, URL-safe string so a simulator iframe
 * starts in the right state before any postMessage arrives:
 * `touch.camera.dpad` → only the listed keys are true.
 */
export function encodeCapabilities(caps: DeviceCapabilities): string {
  return CAPABILITY_KEYS.filter((k) => caps[k]).join(".");
}

export function decodeCapabilities(value: string | null | undefined): Partial<DeviceCapabilities> | null {
  if (value == null) return null;
  const on = new Set(value.split(".").filter(Boolean));
  const out: Partial<DeviceCapabilities> = {};
  for (const key of CAPABILITY_KEYS) out[key] = on.has(key);
  return out;
}

/** Best-effort detection for a real browser. Hardware presence ≠ permission. */
export function detectBrowserCapabilities(win: Window = window): DeviceCapabilities {
  const nav = win.navigator;
  const hasMediaDevices = Boolean(nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === "function");
  const legacy = Boolean((nav as Navigator & { webkitGetUserMedia?: unknown; getUserMedia?: unknown }).webkitGetUserMedia ?? (nav as Navigator & { getUserMedia?: unknown }).getUserMedia);
  const coarse = typeof win.matchMedia === "function" && win.matchMedia("(any-pointer: coarse)").matches;
  const fine = typeof win.matchMedia === "function" && win.matchMedia("(any-pointer: fine)").matches;
  const speech = "SpeechRecognition" in win || "webkitSpeechRecognition" in win;
  return {
    touch: coarse || fine || nav.maxTouchPoints > 0,
    camera: (hasMediaDevices || legacy) && win.isSecureContext,
    microphone: hasMediaDevices && win.isSecureContext && speech,
    alexa: false,
    dpad: false,
    ollabridgeOnline: true,
    homepilotOnline: true,
  };
}

export function mergeCapabilities(
  base: DeviceCapabilities,
  ...overrides: Array<Partial<DeviceCapabilities> | null | undefined>
): DeviceCapabilities {
  const out = { ...base };
  for (const o of overrides) {
    if (!o) continue;
    for (const key of CAPABILITY_KEYS) {
      const v = o[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}
