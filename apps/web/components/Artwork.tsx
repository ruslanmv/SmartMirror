"use client";

import type { CSSProperties, ReactNode } from "react";

import type { ArtStyle, FrameStyle } from "@/lib/settings";

/**
 * Painterly rendering for Portrait mode. The same SVG filters apply to a
 * still photo or the live <video>, so a wall-mounted Echo Show can show a
 * "painting" of the person standing in front of it in real time.
 */
export function ArtFilters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {/* Oil: brush wobble, then an erode→dilate "opening" that flattens detail
            into paint patches, richer colour and a touch of contrast. The impasto
            relief comes from the lit brush-stroke texture layered on top. */}
        <filter id="sm-art-oil" x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.011 0.032" numOctaves="3" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G" result="brush" />
          <feMorphology in="brush" operator="erode" radius="1.6" result="eroded" />
          <feMorphology in="eroded" operator="dilate" radius="1.6" result="patches" />
          <feColorMatrix in="patches" type="saturate" values="1.22" result="rich" />
          <feComponentTransfer in="rich">
            <feFuncR type="gamma" amplitude="1.04" exponent="1.08" offset="0" />
            <feFuncG type="gamma" amplitude="1.03" exponent="1.08" offset="0" />
            <feFuncB type="gamma" amplitude="1" exponent="1.1" offset="0" />
          </feComponentTransfer>
        </filter>
        {/* Watercolour: wide wash displacement, soft bleed, lighter pigment. */}
        <filter id="sm-art-watercolor" x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="2" result="wash" />
          <feDisplacementMap in="SourceGraphic" in2="wash" scale="16" xChannelSelector="R" yChannelSelector="B" result="bleed" />
          <feGaussianBlur in="bleed" stdDeviation="1.4" result="soft" />
          <feColorMatrix in="soft" type="saturate" values="0.85" result="pale" />
          <feComponentTransfer in="pale">
            <feFuncR type="linear" slope="0.85" intercept="0.15" />
            <feFuncG type="linear" slope="0.85" intercept="0.14" />
            <feFuncB type="linear" slope="0.82" intercept="0.14" />
          </feComponentTransfer>
        </filter>
        {/* Charcoal: monochrome, strong contrast, grainy strokes. */}
        <filter id="sm-art-charcoal" x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="4" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="3" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feColorMatrix in="rough" type="saturate" values="0" result="mono" />
          <feComponentTransfer in="mono">
            <feFuncR type="linear" slope="1.7" intercept="-0.32" />
            <feFuncG type="linear" slope="1.7" intercept="-0.32" />
            <feFuncB type="linear" slope="1.6" intercept="-0.3" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export const ART_FILTER: Record<ArtStyle, string> = {
  photo: "none",
  oil: "url(#sm-art-oil) contrast(1.06)",
  watercolor: "url(#sm-art-watercolor) brightness(1.04)",
  charcoal: "url(#sm-art-charcoal)",
  vintage: "sepia(0.6) contrast(1.08) saturate(0.75) brightness(0.96)",
};

export interface PaintingProps {
  style: ArtStyle;
  frame: FrameStyle;
  /** "fill" makes the framed painting the whole screen; "wall" hangs it on a wall. */
  layout: "fill" | "wall";
  imageUrl?: string | null;
  /** Live media (a <video>) rendered instead of an image. */
  media?: ReactNode;
  mirrored?: boolean;
  title?: string;
  subtitle?: string;
  overlay?: ReactNode;
}

export function Painting({ style, frame, layout, imageUrl, media, mirrored, title, subtitle, overlay }: PaintingProps) {
  const mediaStyle: CSSProperties = { filter: ART_FILTER[style], transform: mirrored ? "scaleX(-1)" : undefined };
  return (
    <figure className={`painting painting--${layout} painting--frame-${frame} painting--${style}`}>
      <div className="painting__frame">
        <div className="painting__liner">
          <div className="painting__canvas">
            {media || imageUrl ? (
              <div className="painting__media" style={mediaStyle}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                {media ?? <img src={imageUrl!} alt={title ?? "Portrait"} />}
              </div>
            ) : (
              <div className="painting__placeholder" />
            )}
            {style !== "photo" && <div className="painting__texture" aria-hidden="true" />}
            <div className="painting__varnish" aria-hidden="true" />
            {overlay}
          </div>
        </div>
      </div>
      {layout === "wall" && (title || subtitle) && (
        <figcaption className="painting__plaque">
          {title && <span className="painting__plaque-title">{title}</span>}
          {subtitle && <span className="painting__plaque-sub">{subtitle}</span>}
        </figcaption>
      )}
    </figure>
  );
}
