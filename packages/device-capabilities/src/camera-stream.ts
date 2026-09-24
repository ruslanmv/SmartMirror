/**
 * getUserMedia with backwards compatibility for the WebViews SmartMirror runs in:
 *
 *  - modern browsers and Chromium WebViews: navigator.mediaDevices.getUserMedia
 *  - old WebKit/Android WebViews:          navigator.getUserMedia / webkitGetUserMedia
 *  - cameras that reject HD / facing-mode constraints: retried with looser ones
 *
 * The same function serves the laptop browser, the Echo Show WebView shell and
 * an Alexa.Presentation.HTML session, so the camera path can be tested live on
 * a Vercel preview before touching the device.
 */

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  success: (stream: MediaStream) => void,
  failure: (err: unknown) => void,
) => void;

interface LegacyNavigator {
  getUserMedia?: LegacyGetUserMedia;
  webkitGetUserMedia?: LegacyGetUserMedia;
  mozGetUserMedia?: LegacyGetUserMedia;
}

export type CameraApi = "mediaDevices" | "legacy" | "none";

export function cameraApi(win: Window = window): CameraApi {
  const nav = win.navigator as Navigator & LegacyNavigator;
  if (nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === "function") return "mediaDevices";
  if (nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia) return "legacy";
  return "none";
}

/** Camera capture needs an API *and* a secure context (HTTPS or localhost). */
export function hasWebCamera(win: Window = window): boolean {
  return cameraApi(win) !== "none" && win.isSecureContext !== false;
}

function callGetUserMedia(win: Window, constraints: MediaStreamConstraints): Promise<MediaStream> {
  const nav = win.navigator as Navigator & LegacyNavigator;
  if (nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === "function") {
    return nav.mediaDevices.getUserMedia(constraints);
  }
  const legacy = nav.getUserMedia ?? nav.webkitGetUserMedia ?? nav.mozGetUserMedia;
  if (!legacy) return Promise.reject(new CameraError("unsupported", "This browser has no camera API"));
  return new Promise((resolve, reject) => legacy.call(nav, constraints, resolve, reject));
}

export type CameraErrorKind = "unsupported" | "insecure" | "denied" | "not-found" | "busy" | "unknown";

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export function classifyCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new CameraError("denied", "Camera permission was denied");
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new CameraError("not-found", "No camera matches on this device");
    case "NotSupportedError":
      return new CameraError("unsupported", "Camera capture is not supported here");
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new CameraError("busy", "The camera is in use by another app");
    default:
      return new CameraError("unknown", (err as { message?: string } | null)?.message || "Camera failed to start");
  }
}

export interface OpenCameraOptions {
  deviceId?: string | null;
  facingMode?: "user" | "environment";
  /** Preferred capture size; portrait framing suits full-body photos. */
  ideal?: { width: number; height: number };
}

/** Constraint ladder: exact wishes first, then progressively looser. */
export function constraintLadder(opts: OpenCameraOptions = {}): MediaStreamConstraints[] {
  const ideal = opts.ideal ?? { width: 1280, height: 1706 };
  const size = { width: { ideal: ideal.width }, height: { ideal: ideal.height } };
  const ladder: MediaTrackConstraints[] = [];
  if (opts.deviceId) ladder.push({ deviceId: { exact: opts.deviceId }, ...size });
  ladder.push({ facingMode: opts.facingMode ?? "user", ...size });
  ladder.push({ width: { ideal: 1280 }, height: { ideal: 720 } });
  return [...ladder.map((video) => ({ video, audio: false })), { video: true, audio: false }];
}

export async function openCameraStream(opts: OpenCameraOptions = {}, win: Window = window): Promise<MediaStream> {
  if (cameraApi(win) === "none") throw new CameraError("unsupported", "This browser has no camera API");
  if (win.isSecureContext === false) throw new CameraError("insecure", "The camera needs HTTPS");
  let last: CameraError | null = null;
  for (const constraints of constraintLadder(opts)) {
    try {
      return await callGetUserMedia(win, constraints);
    } catch (err) {
      last = classifyCameraError(err);
      // Permission and busy errors will not improve with looser constraints.
      if (last.kind === "denied" || last.kind === "busy") throw last;
    }
  }
  throw last ?? new CameraError("unknown", "Camera failed to start");
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Attach a stream to a <video>, including the pre-srcObject fallback. */
export function attachStream(video: HTMLVideoElement, stream: MediaStream) {
  if ("srcObject" in video) {
    video.srcObject = stream;
  } else {
    (video as HTMLVideoElement & { src: string }).src = URL.createObjectURL(stream as unknown as Blob);
  }
  video.muted = true;
  video.setAttribute("playsinline", "");
  void video.play().catch(() => {});
}

export type CameraPermission = "granted" | "denied" | "prompt" | "unknown";

export interface CameraProbe {
  api: CameraApi;
  secureContext: boolean;
  permission: CameraPermission;
  /** Number of video inputs; labels are only exposed after permission is granted. */
  devices: Array<{ deviceId: string; label: string }>;
}

/** Non-invasive probe: never opens the camera or triggers a prompt. */
export async function probeCamera(win: Window = window): Promise<CameraProbe> {
  const api = cameraApi(win);
  let permission: CameraPermission = "unknown";
  try {
    const status = await win.navigator.permissions?.query({ name: "camera" as PermissionName });
    if (status) permission = status.state as CameraPermission;
  } catch {
    // Safari and many WebViews do not support querying "camera".
  }
  let devices: CameraProbe["devices"] = [];
  try {
    const all = (await win.navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    devices = all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    devices = [];
  }
  return { api, secureContext: win.isSecureContext !== false, permission, devices };
}
