import { describe, expect, it } from "vitest";

import {
  DEVICE_PROFILES,
  decodeCapabilities,
  encodeCapabilities,
  mergeCapabilities,
  parseSimulatorMessage,
  resolveCameraSources,
} from "./index";

describe("capability encoding", () => {
  it("round-trips every profile", () => {
    for (const profile of Object.values(DEVICE_PROFILES)) {
      const decoded = decodeCapabilities(encodeCapabilities(profile.capabilities));
      expect(decoded).toEqual(profile.capabilities);
    }
  });

  it("treats an empty string as everything off", () => {
    const decoded = decodeCapabilities("");
    expect(decoded && Object.values(decoded).every((v) => v === false)).toBe(true);
  });

  it("merges only boolean overrides", () => {
    const base = DEVICE_PROFILES.browser.capabilities;
    const merged = mergeCapabilities(base, { camera: false }, null, { touch: undefined });
    expect(merged.camera).toBe(false);
    expect(merged.touch).toBe(true);
  });
});

describe("camera sources", () => {
  it("never leaves the conservative Echo profile without a capture path", () => {
    const sources = resolveCameraSources({
      capabilities: DEVICE_PROFILES["echo-show-21"].capabilities,
      runtime: "echo-shell",
      hasNativeBridge: true,
    });
    const available = sources.filter((s) => s.available).map((s) => s.kind);
    expect(available).toEqual(["companion"]);
    expect(sources.find((s) => s.kind === "native")?.reason).toMatch(/not exposed/);
  });

  it("prefers the native camera on the experimental Echo profile", () => {
    const sources = resolveCameraSources({
      capabilities: DEVICE_PROFILES["echo-show-21-experimental"].capabilities,
      runtime: "echo-shell",
      hasNativeBridge: true,
    });
    expect(sources[0]).toMatchObject({ kind: "native", available: true });
  });

  it("prefers the browser camera for browser development", () => {
    const sources = resolveCameraSources({
      capabilities: DEVICE_PROFILES.browser.capabilities,
      runtime: "browser",
      hasNativeBridge: false,
    });
    expect(sources[0]?.kind).toBe("browser");
    expect(sources.find((s) => s.kind === "native")?.available).toBe(false);
  });
});

describe("simulator protocol", () => {
  it("rejects malformed and foreign messages", () => {
    expect(parseSimulatorMessage(null)).toBeNull();
    expect(parseSimulatorMessage({ type: "webpackOk" })).toBeNull();
    expect(parseSimulatorMessage({ type: "sm:key", key: "Delete" })).toBeNull();
    expect(parseSimulatorMessage({ type: "sm:capabilities", capabilities: { touch: true }, profileId: "x" })).toBeNull();
    expect(parseSimulatorMessage({ type: "sm:alexa", directive: "LaunchRequest" })).toBeNull();
  });

  it("accepts well-formed messages", () => {
    expect(parseSimulatorMessage({ type: "sm:key", key: "ArrowLeft" })).toEqual({ type: "sm:key", key: "ArrowLeft" });
    const caps = DEVICE_PROFILES["echo-show-21"].capabilities;
    expect(parseSimulatorMessage({ type: "sm:capabilities", capabilities: caps, profileId: "echo-show-21" })).not.toBeNull();
  });
});
