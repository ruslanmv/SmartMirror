import type { DeviceCapabilities, Runtime } from "./capabilities";

/**
 * Web mirror of the Android `CameraSource` sealed interface. The try-on flow
 * only ever sees a body-capture image; where it came from is a detail.
 */
export type CameraSourceKind = "native" | "browser" | "companion" | "upload";

export interface CameraSourceOption {
  kind: CameraSourceKind;
  label: string;
  description: string;
  available: boolean;
  /** Why the source is unavailable, shown to the user. */
  reason?: string;
  /** Marked experimental until verified on physical hardware. */
  experimental?: boolean;
}

export interface CameraEnvironment {
  capabilities: DeviceCapabilities;
  runtime: Runtime;
  /** `window.SmartMirrorNative` exists (real shell or simulator emulation). */
  hasNativeBridge: boolean;
  /**
   * getUserMedia (modern or legacy) is available in a secure context. Defaults
   * to true for callers that predate the web-camera fallback.
   */
  hasWebCamera?: boolean;
}

const WEB_CAMERA_COPY: Record<Runtime, { label: string; description: string }> = {
  browser: { label: "This device's camera", description: "Live mirror preview with a countdown, straight from the browser." },
  simulator: { label: "This device's camera", description: "Live mirror preview with a countdown, straight from the browser." },
  "echo-shell": { label: "Echo camera · web", description: "The Echo camera through the app's WebView, with a live mirror preview." },
  "alexa-html": { label: "Screen camera", description: "Try the device camera from the Alexa web app. Falls back to your phone if blocked." },
};

export function resolveCameraSources(env: CameraEnvironment): CameraSourceOption[] {
  const { capabilities: caps, runtime, hasNativeBridge, hasWebCamera = true } = env;
  const isEcho = runtime === "echo-shell";

  const native: CameraSourceOption = {
    kind: "native",
    label: "Echo camera",
    description: "Capture with the device's built-in camera through the SmartMirror shell.",
    experimental: true,
    available: isEcho && hasNativeBridge && caps.camera,
    reason: !isEcho || !hasNativeBridge ? "Only inside the Echo Show shell" : !caps.camera ? "Camera not exposed on this device" : undefined,
  };

  // One live camera path for every runtime: browser getUserMedia, the Echo
  // shell's WebView, or an Alexa HTML session. Native capture stays preferred
  // on Echo because it does not depend on WebView camera support.
  const copy = WEB_CAMERA_COPY[runtime];
  const browser: CameraSourceOption = {
    kind: "browser",
    label: copy.label,
    description: copy.description,
    experimental: runtime === "echo-shell" || runtime === "alexa-html",
    available: hasWebCamera && caps.camera,
    reason: !hasWebCamera ? "No camera API here (needs HTTPS and getUserMedia)" : !caps.camera ? "Camera not available on this device" : undefined,
  };

  const companion: CameraSourceOption = {
    kind: "companion",
    label: "Use your phone",
    description: "Scan a QR code and take the photo with your phone. Works everywhere.",
    available: true,
  };

  const upload: CameraSourceOption = {
    kind: "upload",
    label: "Upload a photo",
    description: "Choose an existing full-length photo from this device.",
    available: caps.touch || !caps.dpad,
    reason: caps.touch || !caps.dpad ? undefined : "Needs a pointer to pick a file",
  };

  // Order: best available first, unavailable last.
  const all = isEcho ? [native, browser, companion, upload] : [browser, companion, upload, native];
  return [...all.filter((s) => s.available), ...all.filter((s) => !s.available)];
}

/** Grab the current frame of a playing video as a mirrored JPEG data URL. */
export function captureVideoFrame(video: HTMLVideoElement, { mirror = true, quality = 0.9 } = {}): string {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Downscale an image so uploads stay well under serverless body limits
 * (Vercel Functions accept ~4.5 MB) and body captures carry less detail than
 * strictly needed.
 */
export async function downscaleImage(dataUrl: string, maxEdge = 1600, quality = 0.86): Promise<string> {
  const img = new Image();
  img.decoding = "async";
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && dataUrl.startsWith("data:image/jpeg")) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
