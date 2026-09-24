import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "sparkle"
  | "hanger"
  | "camera"
  | "looks"
  | "mic"
  | "phone"
  | "upload"
  | "back"
  | "check"
  | "link"
  | "home"
  | "plus"
  | "close"
  | "remote"
  | "wand"
  | "refresh"
  | "shield"
  | "monitor"
  | "alexa"
  | "arrow-right"
  | "chevron-up"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "external"
  | "trash"
  | "speaker";

const PATHS: Record<IconName, ReactNode> = {
  sparkle: (
    <>
      <path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  hanger: (
    <>
      <path d="M12 7.5a2 2 0 1 1 2-2" />
      <path d="M12 7.5v1.5L3.4 15.2a1.5 1.5 0 0 0 .9 2.8h15.4a1.5 1.5 0 0 0 .9-2.8L12 9" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  looks: (
    <>
      <rect x="3.5" y="4" width="11" height="15" rx="1.5" />
      <path d="M17.5 6.5l2.4.6a1 1 0 0 1 .7 1.2l-2.9 11a1 1 0 0 1-1.2.7l-2.2-.6" />
      <path d="M6.5 15l2.5-3 2 2.2 1.5-1.7" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  phone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  upload: <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 15v3A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />,
  back: <path d="M15 5l-7 7 7 7" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  home: <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  remote: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="5" />
      <circle cx="12" cy="8.5" r="2.2" />
      <path d="M10.5 14.5h3M10.5 17.5h3" />
    </>
  ),
  wand: (
    <>
      <path d="M4 20L15 9" />
      <path d="M14 4v2M14 10v2M18 8h2M10 8h2M16.8 5.2l1.4-1.4M11.8 10.2l-1.4 1.4M16.8 10.8l1.4 1.4" />
    </>
  ),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  speaker: (
    <>
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />,
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  alexa: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 16.5c1.2-.6 2.6-1 3.8-1 2 0 3.5 1 3.5 1V9.5a3.5 3.5 0 1 0-7 0" />
    </>
  ),
  "arrow-right": <path d="M5 12h14m0 0l-5.5-5.5M19 12l-5.5 5.5" />,
  "chevron-up": <path d="M6 15l6-6 6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  external: <path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" />,
  trash: <path d="M5 7h14M10 4h4M7 7l.8 12a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1L17 7" />,
};

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number | string;
}

export function Icon({ name, size, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The SmartMirror mark: an arched mirror with a reflection glint. */
export function MirrorMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M8 28V13a8 8 0 0 1 16 0v15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M5.5 28h21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13 12.5l4.5-4.5M13.5 17l7-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
