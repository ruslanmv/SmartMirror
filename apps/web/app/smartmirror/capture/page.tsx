"use client";

import {
  captureVideoFrame,
  downscaleImage,
  requestNativeCapture,
  resolveCameraSources,
  type CameraSourceKind,
  type CameraSourceOption,
} from "@smartmirror/device-capabilities";
import { Badge, Button, TileContent, type IconName } from "@smartmirror/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Mirror } from "@/components/Mirror";
import { QRCode } from "@/components/QRCode";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { useCameraStream } from "@/components/useCameraStream";
import { useDevice } from "@/lib/capabilities";
import { listenForCompanionPhoto, newCompanionCode } from "@/lib/companion";
import { clearCapture, saveCapture } from "@/lib/storage";
import { timeAgo, useCapture } from "@/lib/use-local";

const SOURCE_ICONS: Record<CameraSourceKind, IconName> = {
  native: "camera",
  browser: "monitor",
  companion: "phone",
  upload: "upload",
};

export default function CapturePage() {
  return (
    <Suspense>
      <Capture />
    </Suspense>
  );
}

function Capture() {
  const { capabilities, runtime, hasNativeBridge, ready } = useDevice();
  const params = useSearchParams();
  const next = params.get("next");
  const router = useRouter();
  const toast = useToast();
  const capture = useCapture();

  const sources = useMemo(
    () => resolveCameraSources({ capabilities, runtime, hasNativeBridge }),
    [capabilities, runtime, hasNativeBridge],
  );
  const [selected, setSelected] = useState<CameraSourceKind | null>(null);
  const [review, setReview] = useState<string | null>(null);

  // Default to the best available source once capabilities are known.
  const active = selected && sources.find((s) => s.kind === selected)?.available ? selected : (sources.find((s) => s.available)?.kind ?? "companion");

  const accept = async (dataUrl: string, source: CameraSourceKind) => {
    const small = await downscaleImage(dataUrl);
    saveCapture(small, source);
    setReview(null);
    toast("Photo saved on this screen");
    if (next) router.push(next);
  };

  return (
    <div className="screen">
      <ScreenHeader
        title="Take a photo"
        subtitle="A full-length photo lets your stylist show outfits on you. It stays on this screen for 24 hours."
        actions={
          capture && (
            <Button variant="danger" icon="trash" onClick={() => clearCapture()}>
              Delete photo
            </Button>
          )
        }
      />
      <div className="capture">
        <div className="source-list" role="radiogroup" aria-label="Camera source">
          {ready &&
            sources.map((s, i) => (
              <SourceCard key={s.kind} source={s} active={active === s.kind} first={i === 0} onSelect={() => setSelected(s.kind)} />
            ))}
        </div>

        <section className="sm-panel stage" aria-live="polite">
          {review ? (
            <>
              <div className="stage__view">
                <Mirror imageUrl={review} label="Photo preview" />
              </div>
              <div className="stage__controls">
                <Button variant="primary" size="lg" icon="check" onClick={() => void accept(review, active)} data-autofocus>
                  Use this photo
                </Button>
                <Button size="lg" icon="refresh" onClick={() => setReview(null)}>
                  Retake
                </Button>
              </div>
            </>
          ) : active === "browser" ? (
            <BrowserStage onCaptured={setReview} />
          ) : active === "native" ? (
            <NativeStage onCaptured={setReview} />
          ) : active === "upload" ? (
            <UploadStage onCaptured={setReview} />
          ) : (
            <CompanionStage onCaptured={setReview} />
          )}
          {!review && capture && (
            <p className="stage__note">
              Current photo taken {timeAgo(capture.takenAt)}. A new one will replace it.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function SourceCard({ source, active, first, onSelect }: { source: CameraSourceOption; active: boolean; first: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-pressed={active}
      aria-disabled={!source.available}
      className="sm-tile source-card"
      onClick={() => source.available && onSelect()}
      data-autofocus={first || undefined}
    >
      <TileContent
        icon={SOURCE_ICONS[source.kind]}
        title={source.label}
        subtitle={source.description}
        badge={source.experimental ? <Badge tone="warn">Experimental</Badge> : undefined}
      />
      {!source.available && source.reason && <span className="source-card__reason">{source.reason}</span>}
    </button>
  );
}

function BrowserStage({ onCaptured }: { onCaptured: (dataUrl: string) => void }) {
  const { videoRef, state } = useCameraStream(true);
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      const video = videoRef.current;
      setCount(null);
      if (video && state === "live") {
        setFlash(true);
        onCaptured(captureVideoFrame(video));
      }
      return;
    }
    const id = window.setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [count, state, videoRef, onCaptured]);

  return (
    <>
      <div className="stage__view">
        <Mirror label="Live camera preview">
          <video ref={videoRef} muted playsInline autoPlay />
          {state !== "live" && (
            <div className="empty" style={{ position: "absolute", inset: 0, border: 0 }}>
              <p>
                {state === "starting"
                  ? "Waiting for camera permission…"
                  : state === "denied"
                    ? "Camera permission was denied. Use your phone instead."
                    : "No camera found. Use your phone instead."}
              </p>
            </div>
          )}
          {count !== null && count > 0 && (
            <div className="countdown" key={count}>
              {count}
            </div>
          )}
          {flash && <div className="flash" onAnimationEnd={() => setFlash(false)} />}
        </Mirror>
      </div>
      <div className="stage__controls">
        <Button variant="primary" size="lg" icon="camera" disabled={state !== "live" || count !== null} onClick={() => setCount(3)}>
          Capture in 3 s
        </Button>
      </div>
      <p className="stage__note">Step back until your whole body fits inside the arch. Neutral, fitted clothing works best.</p>
    </>
  );
}

function NativeStage({ onCaptured }: { onCaptured: (dataUrl: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      onCaptured(await requestNativeCapture());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="stage__view">
        <Mirror label="Echo camera" caption={<Badge tone="warn">Echo camera · experimental</Badge>} />
      </div>
      <div className="stage__controls">
        <Button variant="primary" size="lg" icon="camera" busy={busy} onClick={() => void take()}>
          Open Echo camera
        </Button>
      </div>
      <p className="stage__note">{error ?? "The SmartMirror app on your Echo opens its camera and hands the photo back here."}</p>
    </>
  );
}

function UploadStage({ onCaptured }: { onCaptured: (dataUrl: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="stage__view">
        <Mirror label="Upload a photo" caption={<Badge>JPEG or PNG</Badge>} />
      </div>
      <div className="stage__controls">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === "string" && onCaptured(reader.result);
            reader.readAsDataURL(file);
          }}
        />
        <Button variant="primary" size="lg" icon="upload" onClick={() => input.current?.click()}>
          Choose photo
        </Button>
      </div>
    </>
  );
}

function CompanionStage({ onCaptured }: { onCaptured: (dataUrl: string) => void }) {
  const { postToSimulator } = useDevice();
  const [code, setCode] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const c = newCompanionCode();
    setCode(c);
    setOrigin(window.location.origin);
    postToSimulator({ type: "sm:companion", code: c });
    const stop = listenForCompanionPhoto(c, onCaptured);
    return () => {
      stop();
      postToSimulator({ type: "sm:companion", code: null });
    };
  }, [onCaptured, postToSimulator]);

  if (!code) return null;
  const url = `${origin}/companion/${code}`;
  return (
    <div className="stage__view">
      <div className="companion">
        <QRCode value={url} label={`QR code linking to ${url}`} />
        <div className="companion__steps">
          <div className="companion__step">
            <span className="companion__num">1</span>
            <span>
              <b>Scan the code</b> with your phone’s camera.
            </span>
          </div>
          <div className="companion__step">
            <span className="companion__num">2</span>
            <span>
              <b>Prop the phone up</b> a few steps away and take a full-length photo.
            </span>
          </div>
          <div className="companion__step">
            <span className="companion__num">3</span>
            <span>
              <b>It appears here</b> for you to review.
            </span>
          </div>
          <div>
            <p className="sm-faint" style={{ fontSize: "0.8rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Or open <span className="sm-muted">{origin.replace(/^https?:\/\//, "")}/companion</span> and enter
            </p>
            <p className="companion__code">{code}</p>
          </div>
          <span className="waiting">
            <span className="sm-spinner" aria-hidden="true" /> Waiting for your phone…
          </span>
        </div>
      </div>
    </div>
  );
}
