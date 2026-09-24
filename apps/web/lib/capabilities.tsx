"use client";

import {
  DEVICE_PROFILES,
  decodeCapabilities,
  detectBrowserCapabilities,
  getDeviceProfile,
  mergeCapabilities,
  parseSimulatorMessage,
  readNativeCapabilities,
  type DeviceCapabilities,
  type DeviceToSimulator,
  type Runtime,
} from "@smartmirror/device-capabilities";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, setSimulatedConnectivity } from "./api";
import { isAlexaActive } from "./alexa";
import { installSimulatedNativeBridge } from "./simulated-native";
import type { HealthReport } from "./tools";

export interface DeviceContextValue {
  ready: boolean;
  capabilities: DeviceCapabilities;
  runtime: Runtime;
  /** Running inside (or launched from) the Vercel simulator. */
  simulated: boolean;
  profileId: string | null;
  hasNativeBridge: boolean;
  health: HealthReport | null;
  refreshHealth: () => void;
  /** Notify the simulator parent window, if any. */
  postToSimulator: (message: DeviceToSimulator) => void;
}

const DEFAULT_CAPS: DeviceCapabilities = { ...DEVICE_PROFILES.browser.capabilities, camera: false, microphone: false };

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDevice must be used inside <DeviceProvider>");
  return ctx;
}

interface Detected {
  capabilities: DeviceCapabilities;
  runtime: Runtime;
  simulated: boolean;
  profileId: string | null;
}

function detect(forceRuntime?: Runtime): Detected {
  const url = new URL(window.location.href);
  const profile = getDeviceProfile(url.searchParams.get("sim"));
  if (profile) {
    return {
      capabilities: mergeCapabilities(profile.capabilities, decodeCapabilities(url.searchParams.get("caps"))),
      runtime: profile.runtime,
      simulated: true,
      profileId: profile.id,
    };
  }
  if (window.SmartMirrorNative) {
    return {
      capabilities: mergeCapabilities(DEVICE_PROFILES["echo-show-21"].capabilities, readNativeCapabilities()),
      runtime: "echo-shell",
      simulated: false,
      profileId: null,
    };
  }
  const browser = detectBrowserCapabilities();
  if (forceRuntime === "alexa-html" || isAlexaActive() || url.searchParams.get("runtime") === "alexa-html") {
    // Alexa owns voice; the web app never opens the mic or camera itself there.
    return {
      capabilities: { ...browser, alexa: true, camera: false, microphone: false },
      runtime: "alexa-html",
      simulated: false,
      profileId: null,
    };
  }
  return {
    capabilities: { ...browser, dpad: url.searchParams.get("dpad") === "1" },
    runtime: "browser",
    simulated: false,
    profileId: null,
  };
}

export function DeviceProvider({ children, runtime: forceRuntime }: { children: ReactNode; runtime?: Runtime }) {
  const [state, setState] = useState<Detected & { ready: boolean }>({
    capabilities: DEFAULT_CAPS,
    runtime: forceRuntime ?? "browser",
    simulated: false,
    profileId: null,
    ready: false,
  });
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [hasNativeBridge, setHasNativeBridge] = useState(false);
  const capsRef = useRef(state.capabilities);
  capsRef.current = state.capabilities;

  const postToSimulator = useCallback((message: DeviceToSimulator) => {
    if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
  }, []);

  // Initial detection (client only).
  useEffect(() => {
    const detected = detect(forceRuntime);
    if (detected.simulated && detected.runtime === "echo-shell") {
      installSimulatedNativeBridge(() => capsRef.current);
    }
    setHasNativeBridge(Boolean(window.SmartMirrorNative));
    setState({ ...detected, ready: true });
  }, [forceRuntime]);

  // Simulator control channel.
  useEffect(() => {
    if (!state.simulated) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const msg = parseSimulatorMessage(event.data);
      if (!msg) return;
      if (msg.type === "sm:capabilities") {
        setState((s) => ({ ...s, capabilities: msg.capabilities }));
      } else if (msg.type === "sm:key") {
        window.dispatchEvent(new CustomEvent("sm:remote-key", { detail: msg.key }));
      } else if (msg.type === "sm:alexa") {
        window.dispatchEvent(new CustomEvent("sm:alexa-directive", { detail: msg.directive }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [state.simulated]);

  const refreshHealth = useCallback(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!state.ready) return;
    refreshHealth();
    const id = window.setInterval(refreshHealth, 60_000);
    return () => window.clearInterval(id);
  }, [state.ready, refreshHealth]);

  // Real deployments derive connectivity from health; the simulator overrides it.
  const capabilities = useMemo<DeviceCapabilities>(() => {
    if (state.simulated || !health) return state.capabilities;
    return {
      ...state.capabilities,
      ollabridgeOnline: health.ollabridge !== "down",
      homepilotOnline: health.homepilot !== "down",
    };
  }, [state.capabilities, state.simulated, health]);

  useEffect(() => {
    setSimulatedConnectivity(
      state.simulated
        ? { ollabridgeOnline: capabilities.ollabridgeOnline, homepilotOnline: capabilities.homepilotOnline }
        : { ollabridgeOnline: true, homepilotOnline: true },
    );
    const root = document.documentElement;
    root.dataset.runtime = state.runtime;
    root.dataset.dpad = String(capabilities.dpad);
    root.dataset.touch = String(capabilities.touch);
  }, [capabilities, state.simulated, state.runtime]);

  const value = useMemo<DeviceContextValue>(
    () => ({
      ready: state.ready,
      capabilities,
      runtime: state.runtime,
      simulated: state.simulated,
      profileId: state.profileId,
      hasNativeBridge,
      health,
      refreshHealth,
      postToSimulator,
    }),
    [state.ready, capabilities, state.runtime, state.simulated, state.profileId, hasNativeBridge, health, refreshHealth, postToSimulator],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}
