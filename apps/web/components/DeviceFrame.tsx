"use client";

import type { CSSProperties, ReactNode } from "react";

export type FrameKind = "echo" | "desktop" | "tablet" | "phone";

export interface DeviceFrameProps {
  kind: FrameKind;
  /** CSS viewport of the simulated screen. */
  width: number;
  height: number;
  /** Visual scale applied to the whole device. */
  scale: number;
  cameraOn?: boolean;
  alexaActive?: boolean;
  label: string;
  children: ReactNode;
}

/** Bezel thickness in device pixels, per frame kind. */
export const BEZEL: Record<FrameKind, { x: number; top: number; bottom: number }> = {
  echo: { x: 56, top: 56, bottom: 56 },
  desktop: { x: 0, top: 44, bottom: 0 },
  tablet: { x: 36, top: 36, bottom: 36 },
  phone: { x: 14, top: 14, bottom: 14 },
};

export function frameSize(kind: FrameKind, width: number, height: number) {
  const b = BEZEL[kind];
  return { width: width + b.x * 2, height: height + b.top + b.bottom };
}

/**
 * Renders a device body around a fixed-size viewport and scales the whole
 * thing with a CSS transform, so the app inside sees the real resolution
 * (1920×1080 for Echo Show 21) and its media queries behave as on hardware.
 */
export function DeviceFrame({ kind, width, height, scale, cameraOn = false, alexaActive = false, label, children }: DeviceFrameProps) {
  const outer = frameSize(kind, width, height);
  const b = BEZEL[kind];
  const style = {
    "--frame-w": `${outer.width}px`,
    "--frame-h": `${outer.height}px`,
    width: outer.width * scale,
    height: outer.height * scale,
  } as CSSProperties;

  return (
    <div className={`device device--${kind}`} style={style} role="group" aria-label={label}>
      <div className="device__body" style={{ width: outer.width, height: outer.height, transform: `scale(${scale})` }}>
        {kind === "echo" && (
          <div className="device__camera" data-on={cameraOn} title={cameraOn ? "Camera available" : "Camera shutter closed"}>
            <span className="device__lens" />
            <span className="device__shutter" />
          </div>
        )}
        {kind === "desktop" && (
          <div className="device__chrome" aria-hidden="true">
            <span />
            <span />
            <span />
            <div className="device__url">smartmirror.vercel.app</div>
          </div>
        )}
        <div className="device__screen" style={{ left: b.x, top: b.top, width, height }}>
          {children}
        </div>
        {kind === "echo" && <div className="device__lightbar" data-active={alexaActive} />}
      </div>
    </div>
  );
}
