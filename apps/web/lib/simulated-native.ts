"use client";

import type { DeviceCapabilities } from "@smartmirror/device-capabilities";

/**
 * In the simulator, Echo profiles get a stand-in for the Android shell's
 * `SmartMirrorNative` bridge so the exact same JavaScript path is exercised.
 * `requestCapture` is served by <SimulatedNativeCamera/>, which plays the
 * role of CameraX.
 */
export const NATIVE_CAPTURE_EVENT = "sm:native-capture";

export function installSimulatedNativeBridge(getCaps: () => DeviceCapabilities) {
  if (window.SmartMirrorNative) return;
  window.SmartMirrorNative = {
    getCapabilities() {
      const c = getCaps();
      return JSON.stringify({ camera: c.camera, microphone: c.microphone, touch: c.touch, dpad: c.dpad });
    },
    getDeviceInfo() {
      return JSON.stringify({ shell: "echo-show", shellVersion: "simulator", model: "Echo Show 21 (simulated)", osVersion: "Fire OS (simulated)" });
    },
    requestCapture(requestId: string) {
      if (!getCaps().camera) {
        setTimeout(() => window.SmartMirrorNativeCallback?.resolve(requestId, null, "Camera not available"), 0);
        return;
      }
      window.dispatchEvent(new CustomEvent(NATIVE_CAPTURE_EVENT, { detail: { requestId } }));
    },
  };
}

/** A synthetic "photo" for when the laptop has no webcam or permission is denied. */
export function syntheticCapture(width = 900, height = 1200): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#3a332b");
  bg.addColorStop(1, "#15120f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  ctx.fillStyle = "rgba(236, 222, 200, 0.85)";
  ctx.beginPath();
  ctx.ellipse(cx, height * 0.17, width * 0.075, height * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.03, height * 0.23);
  ctx.lineTo(cx + width * 0.03, height * 0.23);
  ctx.lineTo(cx + width * 0.17, height * 0.3);
  ctx.lineTo(cx + width * 0.13, height * 0.55);
  ctx.lineTo(cx + width * 0.11, height * 0.95);
  ctx.lineTo(cx + width * 0.02, height * 0.95);
  ctx.lineTo(cx, height * 0.6);
  ctx.lineTo(cx - width * 0.02, height * 0.95);
  ctx.lineTo(cx - width * 0.11, height * 0.95);
  ctx.lineTo(cx - width * 0.13, height * 0.55);
  ctx.lineTo(cx - width * 0.17, height * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `600 ${Math.round(width * 0.03)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("SIMULATED CAPTURE", cx, height - height * 0.02);
  return canvas.toDataURL("image/jpeg", 0.85);
}
