import { describe, expect, it, vi } from "vitest";

import { CameraError, cameraApi, constraintLadder, openCameraStream, resolveCameraSources, DEVICE_PROFILES } from "./index";

const fakeStream = { getTracks: () => [] } as unknown as MediaStream;

function fakeWindow(navigator: Record<string, unknown>, secure = true): Window {
  return { navigator, isSecureContext: secure } as unknown as Window;
}

describe("openCameraStream", () => {
  it("uses mediaDevices.getUserMedia when present", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    const win = fakeWindow({ mediaDevices: { getUserMedia } });
    expect(cameraApi(win)).toBe("mediaDevices");
    await expect(openCameraStream({}, win)).resolves.toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("falls back to legacy webkitGetUserMedia on old WebViews", async () => {
    const webkitGetUserMedia = vi.fn((_c, ok: (s: MediaStream) => void) => ok(fakeStream));
    const win = fakeWindow({ webkitGetUserMedia });
    expect(cameraApi(win)).toBe("legacy");
    await expect(openCameraStream({}, win)).resolves.toBe(fakeStream);
  });

  it("relaxes constraints when the camera cannot satisfy them", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce({ name: "OverconstrainedError" })
      .mockRejectedValueOnce({ name: "OverconstrainedError" })
      .mockResolvedValue(fakeStream);
    await expect(openCameraStream({}, fakeWindow({ mediaDevices: { getUserMedia } }))).resolves.toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(getUserMedia.mock.calls[2]![0]).toEqual(constraintLadder()[2]);
  });

  it("stops immediately when permission is denied", async () => {
    const getUserMedia = vi.fn().mockRejectedValue({ name: "NotAllowedError" });
    await expect(openCameraStream({}, fakeWindow({ mediaDevices: { getUserMedia } }))).rejects.toMatchObject({ kind: "denied" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("refuses insecure contexts and missing APIs", async () => {
    await expect(openCameraStream({}, fakeWindow({ mediaDevices: { getUserMedia: vi.fn() } }, false))).rejects.toMatchObject({ kind: "insecure" });
    await expect(openCameraStream({}, fakeWindow({}))).rejects.toBeInstanceOf(CameraError);
  });

  it("tries a chosen device first", () => {
    const ladder = constraintLadder({ deviceId: "cam-2" });
    expect(ladder[0]!.video).toMatchObject({ deviceId: { exact: "cam-2" } });
    expect(ladder.at(-1)).toEqual({ video: true, audio: false });
  });
});

describe("web camera fallback per runtime", () => {
  it("offers the WebView camera on Echo after the native bridge", () => {
    const sources = resolveCameraSources({
      capabilities: DEVICE_PROFILES["echo-show-21-experimental"].capabilities,
      runtime: "echo-shell",
      hasNativeBridge: true,
      hasWebCamera: true,
    });
    expect(sources.slice(0, 2).map((s) => s.kind)).toEqual(["native", "browser"]);
  });

  it("uses the web camera on Echo when there is no native bridge", () => {
    const sources = resolveCameraSources({
      capabilities: DEVICE_PROFILES["echo-show-21-experimental"].capabilities,
      runtime: "echo-shell",
      hasNativeBridge: false,
      hasWebCamera: true,
    });
    expect(sources[0]?.kind).toBe("browser");
  });

  it("lets an Alexa session try the camera, else falls back to the phone", () => {
    const alexa = DEVICE_PROFILES["echo-show-21-alexa"].capabilities;
    const off = resolveCameraSources({ capabilities: alexa, runtime: "alexa-html", hasNativeBridge: false, hasWebCamera: true });
    expect(off[0]?.kind).toBe("companion");
    const on = resolveCameraSources({ capabilities: { ...alexa, camera: true }, runtime: "alexa-html", hasNativeBridge: false, hasWebCamera: true });
    expect(on[0]).toMatchObject({ kind: "browser", label: "Screen camera" });
  });

  it("never offers a web camera without the API", () => {
    const sources = resolveCameraSources({
      capabilities: DEVICE_PROFILES.browser.capabilities,
      runtime: "browser",
      hasNativeBridge: false,
      hasWebCamera: false,
    });
    expect(sources.find((s) => s.kind === "browser")?.available).toBe(false);
  });
});
