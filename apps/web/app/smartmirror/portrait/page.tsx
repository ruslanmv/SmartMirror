"use client";

import { Button, Icon, buttonClass } from "@smartmirror/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ArtFilters, Painting } from "@/components/Artwork";
import { useNow } from "@/components/Clock";
import { useCameraStream } from "@/components/useCameraStream";
import { useDevice } from "@/lib/capabilities";
import {
  ART_STYLES,
  FRAMES,
  useSettings,
  usePortraitPhoto,
  type MirrorSettings,
  type PaintingSource,
} from "@/lib/settings";
import { useCapture, useLooks } from "@/lib/use-local";

import "./portrait.css";

const SOURCES: Array<{ id: PaintingSource; label: string }> = [
  { id: "live", label: "Live" },
  { id: "latest", label: "Latest photo" },
  { id: "look", label: "Saved look" },
  { id: "custom", label: "My photo" },
];

function cycle<T extends { id: string }>(list: T[], current: string): T["id"] {
  const i = list.findIndex((x) => x.id === current);
  return list[(i + 1) % list.length]!.id;
}

/**
 * Full-screen mode for a wall-mounted screen:
 *  - Real mirror: the live camera, mirrored, edge to edge, nothing else.
 *  - Painting: the live camera or a chosen photo rendered as a framed artwork.
 * Any key, tap or pointer movement reveals the controls; Back exits.
 */
export default function PortraitPage() {
  const router = useRouter();
  const { settings, update, ready } = useSettings();
  const { capabilities, hasWebCamera } = useDevice();
  const capture = useCapture();
  const looks = useLooks();
  const custom = usePortraitPhoto();
  const now = useNow(15_000);

  const cameraOk = capabilities.camera && hasWebCamera;
  const needsLive = settings.fullscreenMode === "mirror" || settings.source === "live";
  const stream = useCameraStream(ready && cameraOk && needsLive);
  const liveBroken = stream.state === "denied" || stream.state === "unavailable";
  const liveOk = cameraOk && !liveBroken;

  const mode = settings.fullscreenMode === "mirror" && liveOk ? "mirror" : "painting";

  const lookPreview = (settings.lookId ? looks.find((l) => l.id === settings.lookId) : null)?.preview ?? looks.find((l) => l.preview)?.preview ?? null;
  const chosenStill =
    settings.source === "custom" ? custom : settings.source === "look" ? lookPreview : settings.source === "latest" ? capture?.dataUrl : null;
  const still = chosenStill ?? custom ?? capture?.dataUrl ?? lookPreview ?? null;
  const paintLive = settings.source === "live" && liveOk;

  const medium = ART_STYLES.find((s) => s.id === settings.artStyle)?.medium ?? "";
  const subtitle = settings.plaqueSubtitle || `${medium}, ${new Date().getFullYear()}`;

  // ---- Controls: hidden until the viewer interacts ----
  const [controls, setControls] = useState(false);
  const hideTimer = useRef(0);
  const reveal = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), 6000);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !controls) {
        router.push("/smartmirror");
        return;
      }
      if (!controls) {
        // First press only wakes the controls; it must not also navigate.
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      reveal();
    };
    const onRemote = () => reveal();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", reveal);
    window.addEventListener("pointerdown", reveal);
    window.addEventListener("sm:remote-key", onRemote);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("pointerdown", reveal);
      window.removeEventListener("sm:remote-key", onRemote);
      window.clearTimeout(hideTimer.current);
    };
  }, [controls, reveal, router]);

  const set = (patch: Partial<MirrorSettings>) => {
    update(patch);
    reveal();
  };

  const video = <video ref={stream.setVideo} muted playsInline autoPlay />;

  return (
    <div className={`portrait-mode portrait-mode--${mode}${controls ? " has-controls" : ""}`}>
      <ArtFilters />

      {mode === "mirror" ? (
        <div className="real-mirror" role="img" aria-label="Live mirror">
          {video}
          <div className="real-mirror__glass" aria-hidden="true" />
          {stream.state !== "live" && <p className="real-mirror__status">Opening the mirror…</p>}
        </div>
      ) : (
        <Painting
          style={settings.artStyle}
          frame={settings.frame}
          layout={settings.layout}
          media={paintLive ? video : undefined}
          mirrored={paintLive}
          imageUrl={paintLive ? null : still}
          title={settings.plaqueTitle}
          subtitle={subtitle}
          overlay={
            !paintLive && !still ? (
              <p className="painting__empty">
                Take a photo or choose one in Settings
                <br />
                to hang your portrait here.
              </p>
            ) : undefined
          }
        />
      )}

      {settings.showClock && now && (
        <div className="portrait-clock" aria-hidden="true">
          <span className="portrait-clock__time">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
          <span className="portrait-clock__date">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
      )}

      {controls && (
        <div className="portrait-controls" data-dpad-scope role="toolbar" aria-label="Portrait controls">
          <Button
            size="sm"
            variant="primary"
            icon={settings.fullscreenMode === "mirror" ? "looks" : "monitor"}
            onClick={() => set({ fullscreenMode: settings.fullscreenMode === "mirror" ? "painting" : "mirror" })}
            data-autofocus
          >
            {settings.fullscreenMode === "mirror" ? "Show as painting" : "Real mirror"}
          </Button>
          {mode === "painting" && (
            <>
              <Button size="sm" icon="sparkle" onClick={() => set({ artStyle: cycle(ART_STYLES, settings.artStyle) })}>
                {ART_STYLES.find((s) => s.id === settings.artStyle)?.label}
              </Button>
              <Button size="sm" icon="looks" onClick={() => set({ frame: cycle(FRAMES, settings.frame) })}>
                {FRAMES.find((f) => f.id === settings.frame)?.label}
              </Button>
              <Button size="sm" icon="camera" onClick={() => set({ source: cycle(SOURCES, settings.source) })}>
                {SOURCES.find((s) => s.id === settings.source)?.label}
              </Button>
              <Button size="sm" icon="monitor" onClick={() => set({ layout: settings.layout === "fill" ? "wall" : "fill" })}>
                {settings.layout === "fill" ? "Fill screen" : "On the wall"}
              </Button>
            </>
          )}
          <Link href="/smartmirror/settings" className={buttonClass({ size: "sm" })}>
            Settings
          </Link>
          <Button size="sm" variant="ghost" icon="close" onClick={() => router.push("/smartmirror")} data-dpad-back>
            Exit
          </Button>
          {settings.fullscreenMode === "mirror" && !liveOk && (
            <span className="portrait-controls__note">
              <Icon name="camera" width="1em" height="1em" /> No camera here — showing your painting instead.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
