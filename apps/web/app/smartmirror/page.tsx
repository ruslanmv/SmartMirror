"use client";

import { Badge, Button, Chip, Icon, TileContent } from "@smartmirror/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { partOfDay, useNow } from "@/components/Clock";
import { Mirror } from "@/components/Mirror";
import { FrozenPhoto, SnapMirror } from "@/components/SnapMirror";
import { useCameraStream } from "@/components/useCameraStream";
import { useSettings } from "@/lib/settings";
import { api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";
import { timeAgo, useCapture, useLooks } from "@/lib/use-local";

const IDEAS = [
  { label: "Dinner date", prompt: "An elegant outfit for a dinner date tonight" },
  { label: "Office day", prompt: "Sharp but comfortable for the office" },
  { label: "Weekend brunch", prompt: "Relaxed weekend brunch look" },
  { label: "Cocktail party", prompt: "Something statement for a cocktail party" },
  { label: "Travel day", prompt: "Comfortable layers for a travel day" },
];

export default function HomePage() {
  const router = useRouter();
  const now = useNow(60_000);
  const { greeting, when } = partOfDay(now);
  const capture = useCapture();
  const looks = useLooks();
  const { capabilities, runtime, hasNativeBridge, hasWebCamera, ready: deviceReady } = useDevice();
  const [pieces, setPieces] = useState<number | null>(null);

  // Live mirror: it is a mirror, so the real-time camera is on by default.
  // Turn it off in Settings (or with the button below the arch).
  const { settings, update, ready: settingsReady } = useSettings();
  const liveAvailable = capabilities.camera && hasWebCamera;
  const liveMirror = settings.liveMirror;
  const toggleLive = () => update({ liveMirror: !liveMirror });
  // After a snap the photo stays frozen in the arch and the camera turns off,
  // until the user picks Retake or Live mirror. Remembered for this session only,
  // so a fresh start is still a live mirror.
  const [frozen, setFrozenState] = useState(false);
  const [justTaken, setJustTaken] = useState<string | null>(null);
  useEffect(() => {
    try {
      setFrozenState(sessionStorage.getItem("sm:frozen") === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setFrozen = useCallback((value: boolean) => {
    setFrozenState(value);
    if (!value) setJustTaken(null);
    try {
      if (value) sessionStorage.setItem("sm:frozen", "1");
      else sessionStorage.removeItem("sm:frozen");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const frozenUrl = frozen ? (justTaken ?? capture?.dataUrl ?? null) : null;
  const onCaptured = useCallback(
    (url: string) => {
      setJustTaken(url);
      setFrozen(true);
    },
    [setFrozen],
  );

  const live = useCameraStream(settingsReady && liveMirror && liveAvailable && !frozenUrl);
  const liveFailed = live.state === "denied" || live.state === "unavailable";

  // "?snap=1" (Alexa "take my photo", deep links): count down on the live
  // mirror. The decision waits for camera detection; if there is no usable
  // camera the request falls back to the capture screen (phone QR).
  const [autoSnap, setAutoSnap] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("snap") !== "1") return;
    router.replace("/smartmirror");
    setFrozen(false);
    setAutoSnap(true);
  }, [router, setFrozen]);
  useEffect(() => {
    if (!autoSnap || !settingsReady || !deviceReady) return;
    if (!liveMirror || !liveAvailable || liveFailed) {
      setAutoSnap(false);
      router.push("/smartmirror/capture");
    }
  }, [autoSnap, settingsReady, deviceReady, liveMirror, liveAvailable, liveFailed, router]);

  useEffect(() => {
    api
      .wardrobe()
      .then((items) => setPieces(items.length))
      .catch(() => setPieces(null));
  }, [capabilities.ollabridgeOnline, capabilities.homepilotOnline]);

  const directCamera = capabilities.camera && (runtime !== "echo-shell" || hasNativeBridge) && runtime !== "alexa-html";

  return (
    <div className="home">
      <section className="home__mirror" aria-label="Your mirror">
        <div className="portrait-wrap">
          {frozenUrl ? (
            <FrozenPhoto
              url={frozenUrl}
              onRetake={() => {
                setFrozen(false);
                if (!liveMirror) update({ liveMirror: true });
                setAutoSnap(true);
              }}
              onLive={() => {
                setFrozen(false);
                if (!liveMirror) update({ liveMirror: true });
              }}
            />
          ) : liveMirror && liveAvailable && !liveFailed ? (
            <SnapMirror
              onCaptured={onCaptured}
              videoRef={live.videoRef}
              setVideo={live.setVideo}
              streaming={live.state === "live"}
              starting={live.state === "starting"}
              autoSnap={autoSnap}
              onAutoSnapConsumed={() => setAutoSnap(false)}
              extraActions={
                <>
                  <Button size="sm" variant="ghost" icon="close" onClick={toggleLive}>
                    Mirror off
                  </Button>
                  <Link href="/smartmirror/portrait" className="sm-btn sm-btn--sm sm-btn--ghost">
                    <Icon name="monitor" /> Fill screen
                  </Link>
                </>
              }
            />
          ) : (
            <>
              <Mirror
                imageUrl={capture?.dataUrl}
                label={capture ? "Your latest photo" : "Empty mirror"}
                caption={
                  capture ? <Badge tone="accent">Latest photo · {timeAgo(capture.takenAt)}</Badge> : <Badge>No photo yet</Badge>
                }
              />
              <div className="home__mirror-actions">
                {liveAvailable && (
                  <Button size="sm" icon="camera" onClick={toggleLive}>
                    {liveMirror && liveFailed ? "Camera blocked · retry" : "Turn mirror on"}
                  </Button>
                )}
                <Link href="/smartmirror/portrait" className="sm-btn sm-btn--sm">
                  <Icon name="monitor" /> Fill screen
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="home__content">
        <p className="sm-eyebrow">{greeting}</p>
        <h1 className="home__headline">
          What would you like <br />
          to wear <em>{when}</em>?
        </h1>

        <nav className="home__tiles" aria-label="Main actions">
          <Link href="/smartmirror/stylist" className="sm-tile" data-autofocus>
            <TileContent icon="sparkle" title="Ask stylist" subtitle="Outfits from your real wardrobe" />
          </Link>
          <Link href="/smartmirror/wardrobe" className="sm-tile">
            <TileContent
              icon="hanger"
              title="My wardrobe"
              subtitle={pieces === null ? "Browse and add pieces" : `${pieces} piece${pieces === 1 ? "" : "s"}`}
            />
          </Link>
          <Link href="/smartmirror/capture" className="sm-tile">
            <TileContent
              icon="camera"
              title="Take photo"
              subtitle={directCamera ? "Mirror capture with countdown" : "Use your phone’s camera"}
            />
          </Link>
          <Link href="/smartmirror/looks" className="sm-tile">
            <TileContent
              icon="looks"
              title="Recent looks"
              subtitle={looks.length ? `${looks.length} saved on this screen` : "Your saved outfits"}
            />
          </Link>
        </nav>

        <div className="home__ideas">
          <span className="home__ideas-label">Quick ideas</span>
          {IDEAS.map((idea) => (
            <Chip
              key={idea.label}
              onClick={() => router.push(`/smartmirror/stylist?prompt=${encodeURIComponent(idea.prompt)}&auto=1`)}
            >
              {idea.label}
            </Chip>
          ))}
          <Link href="/smartmirror/pairing" className="sm-chip" style={{ textDecoration: "none" }}>
            Connection
          </Link>
          <Link href="/smartmirror/settings" className="sm-chip" style={{ textDecoration: "none" }}>
            Settings
          </Link>
        </div>
      </section>
    </div>
  );
}
