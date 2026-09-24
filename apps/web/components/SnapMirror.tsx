"use client";

import { captureVideoFrame, downscaleImage } from "@smartmirror/device-capabilities";
import { Badge, Button, Icon } from "@smartmirror/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";

import { writeSettings } from "@/lib/settings";
import { saveCapture } from "@/lib/storage";

import { Mirror } from "./Mirror";

/**
 * The mirror as a camera: tap the arch (or press OK, or say "take my photo")
 * → 3·2·1 → shutter. After the shutter the live mirror switches off and the
 * photo stays frozen in the arch (<FrozenPhoto/>) until the user chooses to
 * go live again — like a real photo booth, not a mirror that "moves on".
 *
 *   LIVE ──tap──▶ COUNTDOWN ──0──▶ FROZEN (camera off) ──Retake / Live mirror──▶ LIVE
 *    ▲               │ tap / Back = cancel
 *    └───────────────┘
 */

type Phase = { k: "live" } | { k: "count"; n: number };

const COUNT_FROM = 3;

function beep(freq: number, ms: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio is a nicety */
  }
}

export interface SnapMirrorProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  setVideo: (el: HTMLVideoElement | null) => void;
  streaming: boolean;
  starting: boolean;
  /** Start a countdown as soon as the stream is live (voice, deep link, Retake). */
  autoSnap?: boolean;
  onAutoSnapConsumed?: () => void;
  /** Called with the full-resolution frame at the shutter; the caller freezes it. */
  onCaptured: (dataUrl: string) => void;
  /** Secondary controls shown next to Snap while the mirror is live. */
  extraActions?: ReactNode;
}

export function SnapMirror({ videoRef, setVideo, streaming, starting, autoSnap, onAutoSnapConsumed, onCaptured, extraActions }: SnapMirrorProps) {
  const [phase, setPhase] = useState<Phase>({ k: "live" });

  const start = useCallback(() => {
    if (!streaming) return;
    setPhase((p) => (p.k === "count" ? { k: "live" } : { k: "count", n: COUNT_FROM }));
  }, [streaming]);

  useEffect(() => {
    if (autoSnap && streaming && phase.k === "live") {
      onAutoSnapConsumed?.();
      setPhase({ k: "count", n: COUNT_FROM });
    }
  }, [autoSnap, streaming, phase.k, onAutoSnapConsumed]);

  // Countdown ticks, then the shutter.
  useEffect(() => {
    if (phase.k !== "count") return;
    if (phase.n === 0) {
      const video = videoRef.current;
      setPhase({ k: "live" });
      if (!video || !streaming) return;
      beep(1320, 140);
      const raw = captureVideoFrame(video);
      void downscaleImage(raw).then((small) => saveCapture(small, "mirror"));
      onCaptured(raw);
      return;
    }
    beep(880, 90);
    const id = window.setTimeout(() => setPhase({ k: "count", n: phase.n - 1 }), 1000);
    return () => window.clearTimeout(id);
  }, [phase, streaming, videoRef, onCaptured]);

  // Back / Escape cancels a countdown.
  useEffect(() => {
    if (phase.k !== "count") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPhase({ k: "live" });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase.k]);

  return (
    <>
      <div className="snap-mirror" onClick={start}>
        <Mirror
          label="Live mirror — tap to take a photo"
          caption={
            streaming ? (
              phase.k === "count" ? <Badge tone="accent">Hold still</Badge> : <Badge tone="accent">Live mirror</Badge>
            ) : (
              <Badge>{starting ? "Starting camera…" : "Camera unavailable"}</Badge>
            )
          }
        >
          <video ref={setVideo} muted playsInline autoPlay />
          {phase.k === "count" && phase.n > 0 && (
            <div className="countdown" key={phase.n} aria-live="assertive">
              {phase.n}
            </div>
          )}
        </Mirror>
      </div>

      <div className="home__mirror-actions">
        <Button
          variant="primary"
          icon="camera"
          onClick={start}
          disabled={!streaming}
          data-autofocus={streaming || undefined}
          aria-label={phase.k === "count" ? "Cancel photo" : "Take a photo"}
        >
          {phase.k === "count" ? "Cancel" : "Snap"}
        </Button>
        {phase.k === "live" && extraActions}
      </div>
      {phase.k === "live" && (
        <p className="snap-hint">
          <Icon name="camera" width="1em" height="1em" /> Tap the mirror, press OK, or say “Alexa, take my photo”
        </p>
      )}
    </>
  );
}

/**
 * The photo that was just taken, held still in the arch with the camera off.
 * It stays until the user decides: AI next steps, Retake, or back to the live mirror.
 */
export function FrozenPhoto({ url, onRetake, onLive }: { url: string; onRetake: () => void; onLive: () => void }) {
  const router = useRouter();
  const [flash, setFlash] = useState(true);
  return (
    <>
      <div className="snap-mirror is-review">
        <Mirror label="Your new photo" imageUrl={url} caption={<Badge tone="accent">Your photo · stays on this screen</Badge>}>
          {flash && <div className="flash" onAnimationEnd={() => setFlash(false)} />}
        </Mirror>
      </div>
      <div className="snap-next" role="group" aria-label="What next?">
        <Button variant="primary" icon="sparkle" data-autofocus onClick={() => router.push("/smartmirror/stylist?from=snap")}>
          Style me
        </Button>
        <Button icon="wand" onClick={() => router.push("/smartmirror/tryon")}>
          Try it on
        </Button>
        <Button
          icon="looks"
          onClick={() => {
            writeSettings({ fullscreenMode: "painting", source: "latest" });
            router.push("/smartmirror/portrait");
          }}
        >
          Make it art
        </Button>
      </div>
      <div className="home__mirror-actions">
        <Button size="sm" variant="ghost" icon="refresh" onClick={onRetake}>
          Retake
        </Button>
        <Button size="sm" variant="ghost" icon="camera" onClick={onLive}>
          Live mirror
        </Button>
      </div>
    </>
  );
}
