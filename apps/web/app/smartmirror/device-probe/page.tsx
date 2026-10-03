"use client";

import {
  probeCamera,
  readNativeCapabilities,
  readNativeDeviceInfo,
  requestNativeCapture,
} from "@smartmirror/device-capabilities";
import { Button, StatusPill, type StatusTone } from "@smartmirror/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QRCode } from "@/components/QRCode";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ApiError, api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";
import { APP_VERSION } from "@/lib/version";

/**
 * Device probe (issue #1, docs/device-testing/echo-show-21.md). Open it inside
 * the Echo Show shell on the physical device: it runs every check it can on
 * its own, asks for the few that need a person (D-pad, touch, suspend), and
 * hands the report to a phone as a QR code. Nothing is assumed: a check that
 * cannot run says why.
 */

type Status = "pending" | "pass" | "fail" | "n/a";
type Result = { status: Status; note: string };
type CheckId =
  | "launch"
  | "fullscreen"
  | "dpad"
  | "touch"
  | "camera_enum"
  | "camera_permission"
  | "camera_preview"
  | "jpeg_capture"
  | "native_capture"
  | "microphone"
  | "https_ollabridge"
  | "pairing"
  | "node_listing"
  | "media_upload"
  | "suspend_resume";

const CHECKS: Array<{ id: CheckId; label: string; how: string }> = [
  { id: "launch", label: "App install / launch", how: "automatic" },
  { id: "fullscreen", label: "Full-screen launch", how: "automatic" },
  { id: "dpad", label: "D-pad navigation", how: "press ↑ ↓ ← → and OK on the remote" },
  { id: "touch", label: "Touch events", how: "tap the screen with a finger" },
  { id: "camera_enum", label: "Camera enumeration", how: "automatic" },
  { id: "camera_permission", label: "Camera permission", how: "Start camera" },
  { id: "camera_preview", label: "Camera preview", how: "Start camera" },
  { id: "jpeg_capture", label: "JPEG capture (WebView)", how: "Start camera" },
  { id: "native_capture", label: "Native capture (shell bridge)", how: "Native capture" },
  { id: "microphone", label: "Microphone permission / recording", how: "Test microphone" },
  { id: "https_ollabridge", label: "HTTPS to OllaBridge", how: "automatic" },
  { id: "pairing", label: "OllaBridge pairing", how: "pair at Settings → Connection first" },
  { id: "node_listing", label: "Mirror node listing", how: "automatic once paired" },
  { id: "media_upload", label: "Media upload to the PC", how: "Upload test image (once paired)" },
  { id: "suspend_resume", label: "Suspend / resume", how: "turn the screen off and on, or open another app and come back" },
];

const initial = (): Record<CheckId, Result> =>
  Object.fromEntries(CHECKS.map((c) => [c.id, { status: "pending", note: "" }])) as Record<CheckId, Result>;

const TONE: Record<Status, StatusTone> = { pending: "idle", pass: "ok", fail: "off", "n/a": "warn" };

export default function DeviceProbePage() {
  const { runtime, hasNativeBridge } = useDevice();
  const [results, setResults] = useState(initial);
  const [preview, setPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const keys = useRef(new Set<string>());
  const hidden = useRef(false);

  const set = useCallback((id: CheckId, status: Status, note = "") => {
    setResults((r) => (r[id].status === status && r[id].note === note ? r : { ...r, [id]: { status, note } }));
  }, []);

  const device = useMemo(() => (hasNativeBridge ? readNativeDeviceInfo() : null), [hasNativeBridge]);

  // Automatic checks.
  useEffect(() => {
    set("launch", "pass", hasNativeBridge ? `Echo shell ${device?.shellVersion ?? "?"}` : `runtime ${runtime} (not the Echo shell)`);
    const full = window.innerWidth >= window.screen.width - 2 && window.innerHeight >= window.screen.height - 2;
    set("fullscreen", full ? "pass" : "fail", `${window.innerWidth}×${window.innerHeight} of ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`);

    void probeCamera().then((p) => {
      set("camera_enum", p.devices.length ? "pass" : p.api === "none" ? "n/a" : "fail",
        `${p.api}, ${p.devices.length} video input(s), secure=${p.secureContext}`);
      if (p.permission !== "unknown") set("camera_permission", p.permission === "granted" ? "pass" : "pending", `state: ${p.permission}`);
    });
    if (hasNativeBridge) {
      const caps = readNativeCapabilities();
      if (!caps?.camera) set("native_capture", "n/a", "the shell reports no camera activity");
    } else {
      set("native_capture", "n/a", "no native bridge (run inside the Echo shell)");
    }

    void api
      .health()
      .then((h) => {
        if (h.backend === "demo") {
          set("https_ollabridge", "n/a", "demo backend");
          set("pairing", "n/a", "demo backend");
          set("node_listing", "n/a", "demo backend");
          return;
        }
        set("https_ollabridge", h.ollabridge === "down" ? "fail" : "pass", `backend ${h.backend}, ollabridge ${h.ollabridge}`);
        set("pairing", h.paired ? "pass" : "pending", h.paired ? "paired" : "not paired yet");
        if (h.paired) set("node_listing", h.homepilot === "ok" ? "pass" : "fail", `homepilot ${h.homepilot}`);
      })
      .catch((e: unknown) => set("https_ollabridge", "fail", e instanceof Error ? e.message : "health failed"));
  }, [device, hasNativeBridge, runtime, set]);

  // D-pad, touch and suspend/resume need a person.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) keys.current.add(e.key);
      const n = keys.current.size;
      set("dpad", n === 5 ? "pass" : "pending", `${n}/5 keys seen: ${[...keys.current].join(" ")}`);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch") set("touch", "pass", `touch at ${Math.round(e.clientX)},${Math.round(e.clientY)}`);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hidden.current = true;
      else if (hidden.current) set("suspend_resume", "pass", "page resumed after being hidden");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [set]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      set("camera_permission", "pass", "granted");
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 600));
      const t = stream.getVideoTracks()[0]?.getSettings();
      set("camera_preview", "pass", `${t?.width ?? "?"}×${t?.height ?? "?"} @ ${t?.frameRate ?? "?"} fps`);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const jpeg = canvas.toDataURL("image/jpeg", 0.85);
      setPreview(jpeg);
      set("jpeg_capture", jpeg.startsWith("data:image/jpeg") ? "pass" : "fail", `${Math.round((jpeg.length * 3) / 4 / 1024)} KB`);
      stream.getTracks().forEach((tr) => tr.stop());
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "error";
      set("camera_permission", name === "NotAllowedError" ? "fail" : "n/a", name);
      set("camera_preview", "fail", name);
      set("jpeg_capture", "fail", name);
    }
  };

  const nativeCapture = async () => {
    try {
      const url = await requestNativeCapture();
      setPreview(url);
      set("native_capture", "pass", `${Math.round((url.length * 3) / 4 / 1024)} KB`);
    } catch (e) {
      set("native_capture", "fail", e instanceof Error ? e.message : String(e));
    }
  };

  const testMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => chunks.push(ev.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      await new Promise((r) => setTimeout(r, 1500));
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      const bytes = chunks.reduce((n, c) => n + c.size, 0);
      set("microphone", bytes > 0 ? "pass" : "fail", `${bytes} bytes in 1.5 s`);
    } catch (e) {
      // The Echo shell denies microphone access to the page by design (voice goes through Alexa).
      set("microphone", "n/a", e instanceof DOMException ? `${e.name} (expected inside the Echo shell)` : String(e));
    }
  };

  const uploadTest = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d9b77c";
    ctx.fillRect(0, 0, 64, 48);
    try {
      const r = await api.uploadCapture(canvas.toDataURL("image/jpeg", 0.8));
      set("media_upload", r.stored ? "pass" : "fail", `ref ${r.ref}`);
    } catch (e) {
      set("media_upload", "fail", e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };

  const report = useMemo(
    () =>
      JSON.stringify({
        v: 1,
        at: new Date().toISOString(),
        app: APP_VERSION,
        runtime,
        device: device ? { model: device.model, os: device.osVersion, build: device.build, shell: device.shellVersion } : null,
        ua: navigator.userAgent.slice(0, 160),
        r: Object.fromEntries(CHECKS.map((c) => [c.id, [results[c.id].status, results[c.id].note.slice(0, 60)]])),
      }),
    [device, results, runtime],
  );

  return (
    <div className="screen">
      <ScreenHeader title="Device probe" subtitle="Run every capability check on this device, then scan the report with your phone." />
      <div className="probe">
        <section className="sm-panel probe__checks scroll-area" aria-label="Checks">
          <table className="diag">
            <tbody>
              {CHECKS.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.label}
                    <small>{c.how}</small>
                  </th>
                  <td>
                    <StatusPill tone={TONE[results[c.id].status]}>{results[c.id].status}</StatusPill>
                  </td>
                  <td className="probe__note">{results[c.id].note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="sm-panel probe__side scroll-area">
          <div className="probe__actions">
            <Button variant="primary" icon="camera" onClick={() => void startCamera()} data-autofocus>
              Start camera
            </Button>
            {hasNativeBridge && (
              <Button icon="camera" onClick={() => void nativeCapture()}>
                Native capture
              </Button>
            )}
            <Button icon="mic" onClick={() => void testMicrophone()}>
              Test microphone
            </Button>
            <Button icon="upload" onClick={() => void uploadTest()}>
              Upload test image
            </Button>
          </div>
          <video ref={videoRef} className="probe__video" muted playsInline style={preview ? { display: "none" } : undefined} />
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img className="probe__video" src={preview} alt="Captured test frame" />
          )}
          <p className="sm-eyebrow">Report</p>
          <QRCode value={report} label="QR code with the probe report" />
          <p className="sm-faint">Scan to copy the results into docs/device-testing/echo-show-21.md.</p>
        </aside>
      </div>
    </div>
  );
}
