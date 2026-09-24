/**
 * Contract for the JavaScript interface the Echo Show Android shell injects
 * with `WebView.addJavascriptInterface(bridge, "SmartMirrorNative")`.
 *
 * Android JS interfaces are synchronous and string-typed, so async results are
 * delivered back by the shell calling `window.SmartMirrorNativeCallback.resolve`.
 */

export interface NativeCapabilityReport {
  camera: boolean;
  microphone: boolean;
  touch: boolean;
  dpad: boolean;
}

export interface NativeDeviceInfo {
  shell: "echo-show";
  shellVersion: string;
  model: string;
  osVersion: string;
}

/** Shape of the injected `window.SmartMirrorNative` object. */
export interface SmartMirrorNativeInterface {
  /** JSON-encoded {@link NativeCapabilityReport}. */
  getCapabilities(): string;
  /** JSON-encoded {@link NativeDeviceInfo}. */
  getDeviceInfo(): string;
  /** Starts a native capture; the result arrives via the callback object. */
  requestCapture(requestId: string): void;
}

export interface SmartMirrorNativeCallback {
  resolve(requestId: string, dataUrl: string | null, error: string | null): void;
}

declare global {
  interface Window {
    SmartMirrorNative?: SmartMirrorNativeInterface;
    SmartMirrorNativeCallback?: SmartMirrorNativeCallback;
  }
}

type Pending = { resolve: (dataUrl: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, Pending>();

function ensureCallback(win: Window): void {
  if (win.SmartMirrorNativeCallback) return;
  win.SmartMirrorNativeCallback = {
    resolve(requestId, dataUrl, error) {
      const p = pending.get(requestId);
      if (!p) return;
      pending.delete(requestId);
      clearTimeout(p.timer);
      if (dataUrl) p.resolve(dataUrl);
      else p.reject(new Error(error || "Native capture cancelled"));
    },
  };
}

export function getNativeBridge(win: Window = window): SmartMirrorNativeInterface | null {
  return win.SmartMirrorNative ?? null;
}

export function readNativeCapabilities(win: Window = window): NativeCapabilityReport | null {
  const bridge = getNativeBridge(win);
  if (!bridge) return null;
  try {
    return JSON.parse(bridge.getCapabilities()) as NativeCapabilityReport;
  } catch {
    return null;
  }
}

export function readNativeDeviceInfo(win: Window = window): NativeDeviceInfo | null {
  const bridge = getNativeBridge(win);
  if (!bridge) return null;
  try {
    return JSON.parse(bridge.getDeviceInfo()) as NativeDeviceInfo;
  } catch {
    return null;
  }
}

/** Ask the shell for a photo (CameraX on Echo). Resolves with a JPEG data URL. */
export function requestNativeCapture(win: Window = window, timeoutMs = 60_000): Promise<string> {
  const bridge = getNativeBridge(win);
  if (!bridge) return Promise.reject(new Error("Native camera bridge is not available"));
  ensureCallback(win);
  const requestId = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Native capture timed out"));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    try {
      bridge.requestCapture(requestId);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
