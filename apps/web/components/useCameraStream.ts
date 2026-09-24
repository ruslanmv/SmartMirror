"use client";

import {
  CameraError,
  attachStream,
  openCameraStream,
  probeCamera,
  stopStream,
  type CameraErrorKind,
} from "@smartmirror/device-capabilities";
import { useCallback, useEffect, useRef, useState } from "react";

export type StreamState = "idle" | "starting" | "live" | "denied" | "unavailable";

export interface TrackInfo {
  label: string;
  width: number;
  height: number;
  frameRate: number | null;
  deviceId: string | null;
}

// Privacy indicator: how many live streams are open right now.
let activeStreams = 0;
const CAMERA_ACTIVITY = "sm:camera-activity";

function setActive(delta: number) {
  activeStreams = Math.max(0, activeStreams + delta);
  window.dispatchEvent(new CustomEvent(CAMERA_ACTIVITY, { detail: activeStreams }));
}

/** True while any screen is streaming the camera (drives the "Camera on" pill). */
export function useCameraActive(): boolean {
  const [active, setActiveState] = useState(false);
  useEffect(() => {
    setActiveState(activeStreams > 0);
    const on = (e: Event) => setActiveState((e as CustomEvent<number>).detail > 0);
    window.addEventListener(CAMERA_ACTIVITY, on);
    return () => window.removeEventListener(CAMERA_ACTIVITY, on);
  }, []);
  return active;
}

const ERROR_STATE: Record<CameraErrorKind, StreamState> = {
  denied: "denied",
  insecure: "unavailable",
  unsupported: "unavailable",
  "not-found": "unavailable",
  busy: "unavailable",
  unknown: "unavailable",
};

/**
 * Live camera bound to a <video>. Works with modern and legacy getUserMedia,
 * so the same hook runs in a laptop browser, the Echo Show WebView and an
 * Alexa HTML session. Tracks are always stopped on unmount.
 */
export function useCameraStream(active: boolean, deviceId: string | null = null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<StreamState>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!active) {
      setState("idle");
      return;
    }
    let cancelled = false;
    let counted = false;
    setState("starting");
    setError(null);
    openCameraStream({ deviceId })
      .then(async (stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) attachStream(videoRef.current, stream);
        const t = stream.getVideoTracks()[0];
        const settings = t?.getSettings?.() ?? {};
        setTrack({
          label: t?.label || "Camera",
          width: settings.width ?? 0,
          height: settings.height ?? 0,
          frameRate: settings.frameRate ?? null,
          deviceId: settings.deviceId ?? null,
        });
        setState("live");
        counted = true;
        setActive(1);
        // Labels only become available after permission, so list devices now.
        const probe = await probeCamera();
        if (!cancelled) setDevices(probe.devices);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof CameraError ? err : new CameraError("unknown", String(err));
        setError(e);
        setState(ERROR_STATE[e.kind]);
      });
    return () => {
      cancelled = true;
      if (counted) setActive(-1);
      stopStream(streamRef.current);
      streamRef.current = null;
      setTrack(null);
    };
  }, [active, deviceId, attempt]);

  // Re-attach if the <video> element mounts after the stream is ready.
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) attachStream(el, streamRef.current);
  }, []);

  return { videoRef, setVideo, state, error, track, devices, retry };
}

export function cameraErrorText(state: StreamState, error: CameraError | null): string {
  if (state === "starting") return "Waiting for camera permission…";
  if (state === "denied") return "Camera permission was denied. Allow it in the browser or device settings, or use your phone.";
  switch (error?.kind) {
    case "insecure":
      return "The camera needs HTTPS. Open the Vercel URL (https://…) instead.";
    case "unsupported":
      return "This browser or WebView has no camera API. Use your phone instead.";
    case "not-found":
      return "No camera was found on this device. Use your phone instead.";
    case "busy":
      return "The camera is being used by another app. Close it and retry.";
    default:
      return "The camera could not start. Retry, or use your phone instead.";
  }
}
