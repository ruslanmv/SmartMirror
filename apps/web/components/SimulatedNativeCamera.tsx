"use client";

import { captureVideoFrame } from "@smartmirror/device-capabilities";
import { Badge, Button } from "@smartmirror/ui";
import { useEffect, useState } from "react";

import { NATIVE_CAPTURE_EVENT, syntheticCapture } from "@/lib/simulated-native";

import { useCameraStream } from "./useCameraStream";

/**
 * Stands in for the Echo shell's CameraX activity inside the simulator. The
 * web app calls the same `SmartMirrorNative.requestCapture()` it would on the
 * device; this overlay answers through `SmartMirrorNativeCallback`.
 */
export function SimulatedNativeCamera() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const { videoRef, setVideo, state } = useCameraStream(requestId !== null);

  useEffect(() => {
    const onRequest = (e: Event) => setRequestId((e as CustomEvent<{ requestId: string }>).detail.requestId);
    window.addEventListener(NATIVE_CAPTURE_EVENT, onRequest);
    return () => window.removeEventListener(NATIVE_CAPTURE_EVENT, onRequest);
  }, []);

  if (!requestId) return null;

  const finish = (dataUrl: string | null, error: string | null) => {
    window.SmartMirrorNativeCallback?.resolve(requestId, dataUrl, error);
    setRequestId(null);
  };

  const capture = () => {
    const video = videoRef.current;
    finish(state === "live" && video ? captureVideoFrame(video) : syntheticCapture(), null);
  };

  return (
    <div className="overlay" data-dpad-scope role="dialog" aria-modal="true" aria-label="Echo camera">
      <div className="sm-panel native-camera">
        <Badge tone="warn">Simulated CameraX</Badge>
        <div className="portrait">
          <video ref={setVideo} muted playsInline hidden={state !== "live"} />
          {state !== "live" && (
            <div className="empty" style={{ position: "absolute", inset: 0, border: 0 }}>
              <p>{state === "starting" ? "Opening camera…" : "No webcam — a synthetic test photo will be used."}</p>
            </div>
          )}
        </div>
        <div className="stage__controls">
          <Button variant="primary" size="lg" icon="camera" onClick={capture} data-autofocus>
            Capture
          </Button>
          <Button variant="ghost" size="lg" onClick={() => finish(null, "cancelled")} data-dpad-back>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
