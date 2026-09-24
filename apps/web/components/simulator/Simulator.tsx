"use client";

import {
  DEVICE_PROFILES,
  encodeCapabilities,
  parseDeviceMessage,
  type AlexaDirective,
  type CapabilityKey,
  type DeviceCapabilities,
  type DeviceProfileId,
  type RemoteKey,
  type SimulatorToDevice,
} from "@smartmirror/device-capabilities";
import { Badge, Button, Icon, Wordmark, buttonClass } from "@smartmirror/ui";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DeviceFrame, frameSize, type FrameKind } from "../DeviceFrame";

import { AlexaConsole, CapabilityToggles, EventLog, PanelSection, Remote, type LogEntry } from "./DevPanel";

const BROWSER_PRESETS: Array<{ id: string; label: string; kind: FrameKind; width: number; height: number }> = [
  { id: "desktop", label: "Desktop 1440", kind: "desktop", width: 1440, height: 900 },
  { id: "laptop", label: "Laptop 1280", kind: "desktop", width: 1280, height: 800 },
  { id: "tablet", label: "Tablet", kind: "tablet", width: 1180, height: 820 },
  { id: "phone", label: "Phone", kind: "phone", width: 390, height: 844 },
];

type Zoom = "fit" | "50" | "100";

const KEYMAP: Record<string, RemoteKey> = {
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Enter: "Enter",
  Escape: "Back",
  Backspace: "Back",
};

export function Simulator({ profileId }: { profileId: DeviceProfileId }) {
  const profile = DEVICE_PROFILES[profileId];
  const [caps, setCaps] = useState<DeviceCapabilities>(profile.capabilities);
  const [preset, setPreset] = useState(BROWSER_PRESETS[0]!);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [path, setPath] = useState("/smartmirror");
  const [reloadKey, setReloadKey] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [companionCode, setCompanionCode] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(true);
  const [alexaPulse, setAlexaPulse] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const capsRef = useRef(caps);
  capsRef.current = caps;
  const logId = useRef(1);

  const addLog = useCallback((dir: LogEntry["dir"], text: string) => {
    setLog((l) => [{ id: logId.current++, at: Date.now(), dir, text }, ...l].slice(0, 60));
  }, []);

  const send = useCallback(
    (message: SimulatorToDevice, describe?: string) => {
      iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
      if (describe) addLog("out", describe);
    },
    [addLog],
  );

  // The iframe URL carries the capabilities at load time; later changes go over postMessage.
  const src = useMemo(
    () => `${path.startsWith("/smartmirror") ? path : "/smartmirror"}?sim=${profile.id}&caps=${encodeCapabilities(capsRef.current)}`,
    // Deliberately not keyed on `path`/`caps`: only an explicit reload or profile change reloads the device.
    [profile.id, reloadKey],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      const msg = parseDeviceMessage(event.data);
      if (!msg) return;
      switch (msg.type) {
        case "sm:ready":
          addLog("in", `device ready at ${msg.path}`);
          send({ type: "sm:capabilities", capabilities: capsRef.current, profileId: profile.id });
          break;
        case "sm:navigate":
          setPath(msg.path);
          addLog("in", `navigate ${msg.path}`);
          break;
        case "sm:companion":
          setCompanionCode(msg.code);
          addLog("in", msg.code ? `companion capture opened · code ${msg.code}` : "companion capture closed");
          break;
        case "sm:log":
          addLog("in", msg.message);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [addLog, send, profile.id]);

  const toggle = (key: CapabilityKey, value: boolean) => {
    const next = { ...caps, [key]: value };
    setCaps(next);
    send({ type: "sm:capabilities", capabilities: next, profileId: profile.id }, `${key} → ${value ? "on" : "off"}`);
  };

  const reset = () => {
    setCaps(profile.capabilities);
    send({ type: "sm:capabilities", capabilities: profile.capabilities, profileId: profile.id }, "reset to profile defaults");
  };

  const pressKey = useCallback(
    (key: RemoteKey) => {
      // A real remote talks to a focused WebView; clicking the panel steals focus, so hand it back.
      iframeRef.current?.contentWindow?.focus();
      send({ type: "sm:key", key }, `key ${key}`);
    },
    [send],
  );

  const alexa = (directive: AlexaDirective, utterance: string) => {
    send({ type: "sm:alexa", directive }, `alexa “${utterance}” → ${directive.intent}`);
    setAlexaPulse(true);
    window.setTimeout(() => setAlexaPulse(false), 1800);
  };

  // Keyboard on the simulator page drives the device remote.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable]")) return;
      const key = KEYMAP[e.key];
      if (!key) return;
      e.preventDefault();
      pressKey(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pressKey]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewport = profile.viewport ?? { width: preset.width, height: preset.height };
  const kind: FrameKind = profile.viewport ? "echo" : preset.kind;
  const outer = frameSize(kind, viewport.width, viewport.height);
  const phoneVisible = Boolean(companionCode && showPhone);
  const phoneOuter = frameSize("phone", 390, 844);
  const reserved = phoneVisible ? 0.36 : 0;
  const fit = Math.min(
    (stageSize.width * (1 - reserved) - 32) / outer.width,
    (stageSize.height - 32) / outer.height,
    1,
  );
  const scale = zoom === "fit" ? Math.max(0.1, fit) : zoom === "50" ? 0.5 : 1;
  const phoneScale = Math.max(0.2, Math.min((stageSize.height - 32) / phoneOuter.height, (stageSize.width * reserved - 24) / phoneOuter.width, 0.8));

  const openHref = `${path}?sim=${profile.id}&caps=${encodeCapabilities(caps)}`;

  return (
    <div className="sim">
      <header className="sim-header">
        <Link href="/" className="sim-home" aria-label="Smart Mirror hub">
          <Wordmark />
        </Link>
        <span className="sim-header__divider" />
        <span className="sim-header__title">Device simulator</span>
        <nav className="sim-tabs" aria-label="Device profile">
          {Object.values(DEVICE_PROFILES).map((p) => (
            <Link key={p.id} href={`/simulator/${p.id}`} className="sim-tab" aria-current={p.id === profile.id ? "page" : undefined}>
              {p.name}
            </Link>
          ))}
        </nav>
        <Link href="/smartmirror" className={buttonClass({ size: "sm" })} target="_blank">
          Open app <Icon name="external" />
        </Link>
      </header>

      <div className="sim-body">
        <div className="sim-stage-wrap">
          <div className="sim-stage" ref={stageRef} data-zoom={zoom}>
            {stageSize.width > 0 && (
              <div className="sim-stage__devices">
                <DeviceFrame
                  kind={kind}
                  width={viewport.width}
                  height={viewport.height}
                  scale={scale}
                  cameraOn={caps.camera}
                  alexaActive={alexaPulse}
                  label={`${profile.name} at ${Math.round(scale * 100)}%`}
                >
                  <iframe
                    key={`${profile.id}-${reloadKey}`}
                    ref={iframeRef}
                    src={src}
                    title={`${profile.name} screen`}
                    allow="camera; microphone; autoplay; fullscreen"
                    style={{ width: viewport.width, height: viewport.height }}
                  />
                </DeviceFrame>
                {phoneVisible && (
                  <DeviceFrame kind="phone" width={390} height={844} scale={phoneScale} label="Companion phone">
                    <iframe src={`/companion/${companionCode}`} title="Companion phone" allow="camera" style={{ width: 390, height: 844 }} />
                  </DeviceFrame>
                )}
              </div>
            )}
          </div>
          <div className="sim-toolbar">
            <span className="sim-path" title="Current route inside the device">
              <Icon name="link" /> {path}
            </span>
            <span className="sim-dim">
              {viewport.width} × {viewport.height} · {Math.round(scale * 100)}%
            </span>
            {!profile.viewport && (
              <div className="sim-seg" role="group" aria-label="Viewport">
                {BROWSER_PRESETS.map((p) => (
                  <button key={p.id} type="button" aria-pressed={preset.id === p.id} onClick={() => setPreset(p)}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="sim-seg" role="group" aria-label="Zoom">
              {(["fit", "50", "100"] as Zoom[]).map((z) => (
                <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                  {z === "fit" ? "Fit" : `${z}%`}
                </button>
              ))}
            </div>
            <Button size="sm" iconOnly icon="refresh" aria-label="Reload device" onClick={() => setReloadKey((k) => k + 1)} />
            <a className={buttonClass({ size: "sm", iconOnly: true })} href={openHref} target="_blank" rel="noreferrer" aria-label="Open this device view in a new tab">
              <Icon name="external" />
            </a>
          </div>
        </div>

        <aside className="sim-panel" aria-label="Developer panel">
          <div className="sim-profile">
            <div className="sim-profile__name">
              {profile.name}
              {profile.viewport ? <Badge tone="accent">16:9</Badge> : <Badge>Responsive</Badge>}
            </div>
            <p className="sim-muted">{profile.description}</p>
          </div>

          <PanelSection
            title="Simulate device capability"
            action={
              <button type="button" className="sim-link" onClick={reset}>
                Reset
              </button>
            }
          >
            <CapabilityToggles capabilities={caps} defaults={profile.capabilities} onChange={toggle} />
          </PanelSection>

          <PanelSection title="Remote control">
            <Remote onKey={pressKey} disabled={!caps.dpad} />
            <p className="sim-muted">{caps.dpad ? "Arrow keys, Enter and Esc on this page also drive the remote." : "Turn on D-pad to use the remote."}</p>
          </PanelSection>

          <PanelSection title="Alexa voice">
            <AlexaConsole enabled={caps.alexa} onDirective={alexa} />
          </PanelSection>

          <PanelSection
            title="Companion phone"
            action={
              companionCode && (
                <button type="button" className="sim-link" onClick={() => setShowPhone((v) => !v)}>
                  {showPhone ? "Hide" : "Show"}
                </button>
              )
            }
          >
            {companionCode ? (
              <p className="sim-muted">
                Capture session <b className="sim-code">{companionCode}</b> is open. Use the phone beside the device to send a photo.
              </p>
            ) : (
              <p className="sim-muted">Open “Take photo → Use your phone” on the device and a phone will appear here.</p>
            )}
          </PanelSection>

          <PanelSection title="Bridge log">
            <EventLog entries={log} onClear={() => setLog([])} />
          </PanelSection>
        </aside>
      </div>
    </div>
  );
}
