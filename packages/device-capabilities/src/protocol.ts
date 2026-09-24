import { CAPABILITY_KEYS, type DeviceCapabilities } from "./capabilities";

/**
 * postMessage protocol between the Vercel simulator (parent window) and the
 * SmartMirror UI running inside the simulated device frame (iframe).
 * Messages are only accepted from the same origin.
 */

export type RemoteKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter" | "Back" | "Home";

export const REMOTE_KEYS: readonly RemoteKey[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Back",
  "Home",
];

export interface AlexaDirective {
  intent: "LaunchRequest" | "StyleIntent" | "WardrobeIntent" | "TryOnIntent" | "PhotoIntent" | "HomeIntent" | "PortraitIntent";
  prompt?: string;
}

/** Parent (simulator) → device UI. */
export type SimulatorToDevice =
  | { type: "sm:capabilities"; capabilities: DeviceCapabilities; profileId: string }
  | { type: "sm:key"; key: RemoteKey }
  | { type: "sm:alexa"; directive: AlexaDirective };

/** Device UI → parent (simulator). */
export type DeviceToSimulator =
  | { type: "sm:ready"; path: string }
  | { type: "sm:navigate"; path: string }
  | { type: "sm:log"; level: "info" | "warn" | "error"; message: string }
  /** A companion-phone capture session opened (code) or closed (null). */
  | { type: "sm:companion"; code: string | null };

const SIM_TYPES = new Set(["sm:capabilities", "sm:key", "sm:alexa"]);
const DEVICE_TYPES = new Set(["sm:ready", "sm:navigate", "sm:log", "sm:companion"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isCapabilities(v: unknown): v is DeviceCapabilities {
  return isRecord(v) && CAPABILITY_KEYS.every((k) => typeof v[k] === "boolean");
}

export function parseSimulatorMessage(data: unknown): SimulatorToDevice | null {
  if (!isRecord(data) || typeof data.type !== "string" || !SIM_TYPES.has(data.type)) return null;
  switch (data.type) {
    case "sm:capabilities":
      return isCapabilities(data.capabilities) && typeof data.profileId === "string"
        ? (data as SimulatorToDevice)
        : null;
    case "sm:key":
      return REMOTE_KEYS.includes(data.key as RemoteKey) ? (data as SimulatorToDevice) : null;
    case "sm:alexa":
      return isRecord(data.directive) && typeof data.directive.intent === "string"
        ? (data as SimulatorToDevice)
        : null;
    default:
      return null;
  }
}

export function parseDeviceMessage(data: unknown): DeviceToSimulator | null {
  if (!isRecord(data) || typeof data.type !== "string" || !DEVICE_TYPES.has(data.type)) return null;
  return data as DeviceToSimulator;
}
