"use client";

import { useEffect, useRef, useState } from "react";

export type StreamState = "idle" | "starting" | "live" | "denied" | "unavailable";

/** getUserMedia lifecycle bound to a <video>; always stops tracks on unmount. */
export function useCameraStream(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<StreamState>("idle");

  useEffect(() => {
    if (!active) {
      setState("idle");
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1706 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play().catch(() => {});
        }
        setState("live");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return { videoRef, state };
}
