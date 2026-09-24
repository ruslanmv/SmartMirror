"use client";

import {
  captureVideoFrame,
  probeCamera,
  readNativeCapabilities,
  readNativeDeviceInfo,
  requestNativeCapture,
  type CameraProbe,
} from "@smartmirror/device-capabilities";
import { Badge, Button, Chip, StatusPill, type StatusTone } from "@smartmirror/ui";
import { useCallback, useEffect, useState } from "react";

import { Mirror } from "@/components/Mirror";
import { ScreenHeader } from "@/components/ScreenHeader";
import { cameraErrorText, useCameraStream } from "@/components/useCameraStream";
import { isAlexaActive } from "@/lib/alexa";
import { useDevice } from "@/lib/capabilities";

/**
 * Camera diagnostics. Open this page on the real target (laptop browser, Echo
 * Show shell, Alexa HTML session, or the simulator) to see which capture
 * paths work there, live, against a Vercel preview.
 */
export default function CameraTestPage() {
  const { runtime, simulated, profileId, capabilities, hasNativeBridge, hasWebCamera } = useDevice();
  const [live, setLive] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { videoRef, setVideo, state, error, track, devices, retry } = useCameraStream(live, deviceId);
  const [probe, setProbe] = useState<CameraProbe | null>(null);
  const [snapshot, setSnapshot] = useState<{ url: string; source: string } | null>(null);
  const [nativeResult, setNativeResult] = useState<string | null>(null);

  const reprobe = useCallback(() => {
    void probeCamera().then(setProbe);
  }, []);
  useEffect(reprobe, [reprobe, state]);

  const native = hasNativeBridge ? readNativeCapabilities() : null;
  const deviceInfo = hasNativeBridge ? readNativeDeviceInfo() : null;

  const webResult: { tone: StatusTone; text: string } =
    state === "live"
      ? { tone: "ok", text: "Streaming" }
      : state === "starting"
        ? { tone: "warn", text: "Starting…" }
        : state === "idle"
          ? { tone: "idle", text: "Not started" }
          : { tone: "off", text: error?.kind ?? state };

  const testNative = async () => {
    setNativeResult("Waiting for the native camera…");
    try {
      const url = await requestNativeCapture();
      setSnapshot({ url, source: "Native bridge" });
      setNativeResult("Native capture succeeded");
    } catch (err) {
      setNativeResult(`Native capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const rows: Array<[string, React.ReactNode]> = [
    ["Runtime", simulated ? `${runtime} (simulator · ${profileId})` : runtime],
    ["Secure context (HTTPS)", <Flag key="s" ok={probe?.secureContext ?? false} />],
    ["Camera API", probe?.api ?? "…"],
    ["Permission", probe?.permission ?? "…"],
    ["Video inputs", probe ? String(probe.devices.length) : "…"],
    ["Web camera usable", <Flag key="w" ok={hasWebCamera} />],
    ["Camera capability", <Flag key="c" ok={capabilities.camera} />],
    ["Native bridge", hasNativeBridge ? `present · camera ${native?.camera ? "yes" : "no"}` : "absent"],
    ["Alexa HTML client", isAlexaActive() ? "active" : runtime === "alexa-html" ? "preview mode" : "no"],
  ];
  if (deviceInfo) rows.push(["Device", `${deviceInfo.model} · ${deviceInfo.osVersion}`]);

  return (
    <div className="screen">
      <ScreenHeader title="Camera test" subtitle="Check every capture path on this device, live." backHref="/smartmirror/capture" />
      <div className="tryon">
        <div className="stage__view" style={{ minHeight: 0 }}>
          <Mirror imageUrl={!live ? snapshot?.url : null} label="Camera test preview" caption={snapshot && !live ? <Badge tone="accent">{snapshot.source} snapshot</Badge> : undefined}>
            {live && <video ref={setVideo} muted playsInline autoPlay />}
            {live && state !== "live" && (
              <div className="empty" style={{ position: "absolute", inset: 0, border: 0 }}>
                <p>{cameraErrorText(state, error)}</p>
              </div>
            )}
            {live && track && state === "live" && (
              <div className="portrait__caption">
                <Badge tone="accent">
                  {track.width}×{track.height}
                  {track.frameRate ? ` · ${Math.round(track.frameRate)} fps` : ""}
                </Badge>
              </div>
            )}
          </Mirror>
        </div>

        <section className="sm-panel tryon__panel" aria-live="polite">
          <p className="sm-eyebrow">Web camera · getUserMedia</p>
          <div className="outfit__actions">
            <Button variant={live ? "default" : "primary"} icon="camera" onClick={() => setLive((v) => !v)} data-autofocus>
              {live ? "Stop camera" : "Start camera"}
            </Button>
            {live && state === "live" && (
              <Button
                icon="check"
                onClick={() => {
                  const video = videoRef.current;
                  if (video) setSnapshot({ url: captureVideoFrame(video), source: "Web camera" });
                  setLive(false);
                }}
              >
                Take test photo
              </Button>
            )}
            {live && (state === "denied" || state === "unavailable") && (
              <Button icon="refresh" onClick={retry}>
                Retry
              </Button>
            )}
            <StatusPill tone={webResult.tone}>{webResult.text}</StatusPill>
          </div>
          {devices.length > 1 && (
            <div className="chip-group">
              <span className="chip-group__label">Cameras</span>
              {devices.map((d) => (
                <Chip key={d.deviceId} pressed={(deviceId ?? track?.deviceId) === d.deviceId} onClick={() => setDeviceId(d.deviceId)}>
                  {d.label}
                </Chip>
              ))}
            </div>
          )}

          <p className="sm-eyebrow" style={{ marginTop: "0.5rem" }}>
            Native camera · Echo shell bridge
          </p>
          <div className="outfit__actions">
            <Button icon="camera" disabled={!hasNativeBridge} onClick={() => void testNative()}>
              Test native capture
            </Button>
            {nativeResult && <span className="sm-muted">{nativeResult}</span>}
            {!hasNativeBridge && <span className="sm-faint">Only inside the Echo app or an Echo simulator profile.</span>}
          </div>

          <dl className="pairing__status">
            {rows.map(([k, v]) => (
              <div className="kv" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="outfit__actions">
            <Button size="sm" variant="ghost" icon="refresh" onClick={reprobe}>
              Re-check
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Flag({ ok }: { ok: boolean }) {
  return <StatusPill tone={ok ? "ok" : "off"}>{ok ? "Yes" : "No"}</StatusPill>;
}
