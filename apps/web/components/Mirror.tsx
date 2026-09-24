"use client";

import type { ReactNode } from "react";

/** Line-art figure shown in the mirror when no capture exists yet. */
export function Silhouette({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 330" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="100" cy="44" rx="21" ry="25" />
        <path d="M91 68v10M109 68v10" />
        <path d="M91 78c-16 3-30 8-37 17-6 25-9 55-11 86M109 78c16 3 30 8 37 17 6 25 9 55 11 86" />
        <path d="M68 104c-2 30 2 55 8 76-6 30-10 62-11 96l-2 50M132 104c2 30-2 55-8 76 6 30 10 62 11 96l2 50" />
        <path d="M76 180c8 6 16 9 24 9s16-3 24-9" />
        <path d="M100 196v130" opacity="0.6" />
      </g>
    </svg>
  );
}

export interface MirrorProps {
  imageUrl?: string | null;
  caption?: ReactNode;
  children?: ReactNode;
  className?: string;
  label?: string;
}

/** The arched mirror frame used on the home, capture and try-on screens. */
export function Mirror({ imageUrl, caption, children, className, label = "Mirror" }: MirrorProps) {
  return (
    <div className={`portrait ${className ?? ""}`} role="img" aria-label={label}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URLs
        <img src={imageUrl} alt="" />
      ) : (
        !children && <Silhouette className="portrait__silhouette" />
      )}
      {children}
      {caption && <div className="portrait__caption">{caption}</div>}
    </div>
  );
}
