"use client";

import { captureVideoFrame, downscaleImage } from "@smartmirror/device-capabilities";
import { Badge, Button, Icon } from "@smartmirror/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { writeSettings } from "@/lib/settings";
import { saveCapture } from "@/lib/storage";

import { Mirror } from "./Mirror";
import { useToast } from "./Toast";

/**
 * The mirror as a camera: tap the arch (or press OK, or say "take my photo")
 * → 3·2·1 → flash → the photo freezes in the arch → one clear next step.
 *
 *   LIVE ──tap──▶ COUNTDOWN ──0──▶ REVIEW ──Style / Try on / Art──▶ AI flow
 *    ▲                 │ tap = cancel      │ Retake → COUNTDOWN
 *    └─────────────────┴───── Done / 20 s idle ◀┘
 */

type Phase = { k: "live" } | { k: "count"; n: number } | { k: "review"; url: string };

const COUNT_FROM = 3;
const REVIEW_TIMEOUT_MS = 20_000;

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
  /** Start a countdown as soon as the stream is live (voice / deep link). */
  autoSnap?: boolean;
  onAutoSnapConsumed?: () => void;
  /** Secondary controls shown next to Snap while the mirror is live. */
  extraActions?: ReactNode;
}

export function SnapMirror({ videoRef, setVideo, streaming, starting, autoSnap, onAutoSnapConsumed, extraActions }: SnapMirrorProps) {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ k: "live" });
  const [flash, setFlash] = useState(false);
  const idle = useRef(0);

  const start = useCallback(() => {
    if (!streaming) return;
    setPhase((p) => (p.k === "count" ? { k: "live" } : { k: "count", n: COUNT_FROM }));
  }, [streaming]);

  // Voice / deep link: "Alexa, ask Smart Mirror to take my photo".
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
      if (!video || !streaming) {
        setPhase({ k: "live" });
        return;
      }
      beep(1320, 140);
      setFlash(true);
      const raw = captureVideoFrame(video);
      setPhase({ k: "review", url: raw });
      void downscaleImage(raw).then((small) => saveCapture(small, "mirror"));
      return;
    }
    beep(880, 90);
    const id = window.setTimeout(() => setPhase({ k: "count", n: phase.n - 1 }), 1000);
    return () => window.clearTimeout(id);
  }, [phase, streaming, videoRef]);

  // Review auto-returns to the live mirror if nobody acts.
  const armIdle = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setPhase({ k: "live" }), REVIEW_TIMEOUT_MS);
  }, []);
  useEffect(() => {
    if (phase.k !== "review") return;
    armIdle();
    const events = ["keydown", "pointerdown", "sm:remote-key"] as const;
    for (const e of events) window.addEventListener(e, armIdle);
    return () => {
      window.clearTimeout(idle.current);
      for (const e of events) window.removeEventListener(e, armIdle);
    };
  }, [phase.k, armIdle]);

  // Back / Escape cancels a countdown or closes the review.
  useEffect(() => {
    if (phase.k === "live") return;
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

  const reviewing = phase.k === "review";

  return (
    <>
      <div className={`snap-mirror${reviewing ? " is-review" : ""}`} onClick={phase.k === "live" ? start : undefined}>
        <Mirror
          label={reviewing ? "Your new photo" : "Live mirror — tap to take a photo"}
          imageUrl={reviewing ? phase.url : null}
          caption={
            reviewing ? (
              <Badge tone="accent">Saved · stays on this screen</Badge>
            ) : streaming ? (
              phase.k === "count" ? <Badge tone="accent">Hold still</Badge> : <Badge tone="accent">Live mirror</Badge>
            ) : (
              <Badge>{starting ? "Starting camera…" : "Camera unavailable"}</Badge>
            )
          }
        >
          {/* The stream stays attached during review so Retake is instant. */}
          <video ref={setVideo} muted playsInline autoPlay hidden={reviewing} />
          {phase.k === "count" && phase.n > 0 && (
            <div className="countdown" key={phase.n} aria-live="assertive">
              {phase.n}
            </div>
          )}
          {flash && <div className="flash" onAnimationEnd={() => setFlash(false)} />}
        </Mirror>
      </div>

      {reviewing ? (
        <div className="snap-next" role="group" aria-label="What next?">
          <Button
            variant="primary"
            icon="sparkle"
            data-autofocus
            onClick={() => router.push("/smartmirror/stylist?from=snap")}
          >
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
          <Button variant="ghost" icon="refresh" onClick={() => setPhase({ k: "count", n: COUNT_FROM })}>
            Retake
          </Button>
          <Button
            variant="ghost"
            icon="check"
            onClick={() => {
              setPhase({ k: "live" });
              toast("Photo kept for 24 hours");
            }}
          >
            Done
          </Button>
        </div>
      ) : (
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
      )}
      {phase.k === "live" && (
        <p className="snap-hint">
          <Icon name="camera" width="1em" height="1em" /> Tap the mirror, press OK, or say “Alexa, take my photo”
        </p>
      )}
    </>
  );
}
