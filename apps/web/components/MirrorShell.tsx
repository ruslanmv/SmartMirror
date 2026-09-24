"use client";

import type { AlexaDirective, Runtime } from "@smartmirror/device-capabilities";
import { Badge, Icon, StatusPill, Wordmark } from "@smartmirror/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { onAlexaDirective, takeStartDirective } from "@/lib/alexa";
import { DeviceProvider, useDevice } from "@/lib/capabilities";
import type { StoredCapture } from "@/lib/storage";
import { timeAgo, useCapture } from "@/lib/use-local";

import { Clock } from "./Clock";
import { DPadFocus } from "./DPadFocus";
import { Mirror } from "./Mirror";
import { SimulatedNativeCamera } from "./SimulatedNativeCamera";
import { ToastProvider, useToast } from "./Toast";

export function MirrorShell({ children, runtime }: { children: ReactNode; runtime?: Runtime }) {
  return (
    <DeviceProvider runtime={runtime}>
      <ToastProvider>
        <Chrome>{children}</Chrome>
      </ToastProvider>
    </DeviceProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const capture = useCapture();

  // The home already has a full-size mirror, capture owns its camera stage,
  // try-on renders the body photo itself, and pairing intentionally stays clean.
  const showPersistentCapture =
    Boolean(capture) &&
    pathname !== "/smartmirror" &&
    !pathname.startsWith("/smartmirror/capture") &&
    !pathname.startsWith("/smartmirror/tryon") &&
    !pathname.startsWith("/smartmirror/pairing");

  return (
    <div className="mirror-app">
      <DPadFocus />
      <TouchGuard />
      <DeviceBridges />
      <SimulatedNativeCamera />
      <header>
        <TopBar />
        <ConnectivityBanner />
      </header>
      <main className={`mirror-main${showPersistentCapture ? " mirror-main--with-capture" : ""}`} id="main">
        {showPersistentCapture && capture ? <PersistentCapture capture={capture} /> : null}
        <div className="mirror-main__content">{children}</div>
      </main>
      <HintBar />
    </div>
  );
}

function PersistentCapture({ capture }: { capture: StoredCapture }) {
  return (
    <aside className="persistent-capture" aria-label="Your latest photo">
      <div className="persistent-capture__image">
        <Mirror imageUrl={capture.dataUrl} label="Your latest photo" />
      </div>
      <div className="persistent-capture__meta">
        <div className="persistent-capture__copy">
          <span className="persistent-capture__label">Latest photo</span>
          <span className="persistent-capture__time">{timeAgo(capture.takenAt)}</span>
        </div>
        <Link href="/smartmirror/capture" className="sm-btn sm-btn--sm">
          Retake
        </Link>
      </div>
    </aside>
  );
}

function TopBar() {
  const { capabilities, health, simulated, profileId } = useDevice();
  const online = capabilities.ollabridgeOnline && capabilities.homepilotOnline;
  return (
    <div className="mirror-top">
      <Link href="/smartmirror" aria-label="Smart Mirror home" tabIndex={-1} style={{ textDecoration: "none" }}>
        <Wordmark />
      </Link>
      <div className="mirror-top__right">
        <div className="mirror-top__status">
          {simulated && profileId && <Badge tone="accent">Simulator · {profileId.replace(/-/g, " ")}</Badge>}
          {health?.backend === "demo" && <Badge>Demo data</Badge>}
          <StatusPill tone={online ? "ok" : "off"}>{online ? "HomePilot online" : "HomePilot offline"}</StatusPill>
        </div>
        <Clock />
      </div>
    </div>
  );
}

function ConnectivityBanner() {
  const { capabilities, health } = useDevice();
  if (!capabilities.ollabridgeOnline) {
    return (
      <div className="banner" role="alert">
        <Icon name="link" />
        <span>
          <b>OllaBridge is unreachable.</b> Your wardrobe and try-ons are paused; saved looks on this screen still work.
        </span>
      </div>
    );
  }
  if (!capabilities.homepilotOnline) {
    return (
      <div className="banner" role="alert">
        <Icon name="home" />
        <span>
          <b>Your HomePilot is offline.</b> Wake your home PC to use the stylist and try-on.
        </span>
      </div>
    );
  }
  if (health?.pairingRequired && !health.paired) {
    return (
      <div className="banner banner--info" role="status">
        <Icon name="link" />
        <span>This screen isn’t paired with your HomePilot yet.</span>
        <Link href="/smartmirror/pairing" className="sm-btn sm-btn--sm sm-btn--primary banner__action">
          Pair now
        </Link>
      </div>
    );
  }
  return null;
}

function HintBar() {
  const { capabilities, runtime } = useDevice();
  return (
    <footer className="hintbar">
      {capabilities.dpad && (
        <>
          <span className="hintbar__item">
            <Icon name="remote" /> <em>Arrows</em> move
          </span>
          <span className="hintbar__item">
            <em>OK</em> selects
          </span>
          <span className="hintbar__item">
            <em>Back</em> returns
          </span>
        </>
      )}
      {(capabilities.alexa || runtime === "alexa-html") && (
        <span className="hintbar__item">
          <Icon name="alexa" /> Say “<em>Alexa, ask Smart Mirror for a dinner outfit</em>”
        </span>
      )}
      <span className="hintbar__item">
        <Icon name="shield" /> Photos stay on this screen and your HomePilot
      </span>
    </footer>
  );
}

/**
 * When the simulator turns touch off, block real pointer input inside the
 * device so anything that silently depends on touch is caught immediately.
 * Keyboard-activated clicks (detail === 0) still pass.
 */
function TouchGuard() {
  const { capabilities, simulated } = useDevice();
  const toast = useToast();
  const lastToast = useRef(0);
  const block = simulated && !capabilities.touch;

  useEffect(() => {
    if (!block) return;
    const stop = (e: Event) => {
      if (e.type === "click" && (e as MouseEvent).detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - lastToast.current > 2500) {
        lastToast.current = Date.now();
        toast("Touch is off for this device profile — use the remote", { tone: "warn", icon: "remote" });
      }
    };
    const types = ["pointerdown", "mousedown", "touchstart", "click", "dblclick", "contextmenu"] as const;
    for (const t of types) window.addEventListener(t, stop, { capture: true, passive: false });
    return () => {
      for (const t of types) window.removeEventListener(t, stop, { capture: true });
    };
  }, [block, toast]);

  return null;
}

const INTENT_ROUTES: Record<AlexaDirective["intent"], string> = {
  LaunchRequest: "/smartmirror",
  HomeIntent: "/smartmirror",
  StyleIntent: "/smartmirror/stylist",
  WardrobeIntent: "/smartmirror/wardrobe",
  TryOnIntent: "/smartmirror/tryon",
  PhotoIntent: "/smartmirror/capture",
};

/** Simulator handshake + Alexa intent routing. */
function DeviceBridges() {
  const { ready, postToSimulator, runtime } = useDevice();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (ready) postToSimulator({ type: "sm:ready", path: window.location.pathname });
  }, [ready, postToSimulator]);

  useEffect(() => {
    if (ready) postToSimulator({ type: "sm:navigate", path: pathname });
  }, [ready, pathname, postToSimulator]);

  useEffect(() => {
    const route = (d: AlexaDirective) => {
      const base = INTENT_ROUTES[d.intent] ?? "/smartmirror";
      const url = d.intent === "StyleIntent" && d.prompt ? `${base}?prompt=${encodeURIComponent(d.prompt)}&auto=1` : base;
      if (d.prompt) toast(`“${d.prompt}”`, { icon: "alexa" });
      router.push(url);
    };
    const onSim = (e: Event) => route((e as CustomEvent<AlexaDirective>).detail);
    window.addEventListener("sm:alexa-directive", onSim);
    const off = onAlexaDirective(route);
    if (runtime === "alexa-html") {
      const start = takeStartDirective();
      if (start && start.intent !== "LaunchRequest") route(start);
    }
    return () => {
      window.removeEventListener("sm:alexa-directive", onSim);
      off();
    };
  }, [router, toast, runtime]);

  return null;
}
