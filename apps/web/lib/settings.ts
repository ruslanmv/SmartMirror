"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-screen display settings (local to this device, like a picture frame's
 * own settings). Nothing here leaves the device.
 */

export type FullscreenMode = "mirror" | "painting";
export type PaintingSource = "live" | "latest" | "look" | "custom";
export type ArtStyle = "photo" | "oil" | "watercolor" | "charcoal" | "vintage";
export type FrameStyle = "gilded" | "walnut" | "modern" | "none";
export type PaintingLayout = "fill" | "wall";

export interface MirrorSettings {
  /** Home arch shows the live camera by default (it is a mirror). */
  liveMirror: boolean;
  /** What "Fill screen" shows: a real mirror, or a framed painting. */
  fullscreenMode: FullscreenMode;
  source: PaintingSource;
  lookId: string | null;
  artStyle: ArtStyle;
  frame: FrameStyle;
  layout: PaintingLayout;
  plaqueTitle: string;
  /** Empty = the medium of the chosen art style, e.g. "Oil on canvas". */
  plaqueSubtitle: string;
  showClock: boolean;
  /** Enter full screen after this many idle minutes on the home screen (0 = never). */
  idleMinutes: number;
  /** HomePilot persona model the stylist talks through; null = discover "stylist". */
  stylistModel: string | null;
  /** Read the stylist's answer aloud. */
  speakReplies: boolean;
}

export const DEFAULT_SETTINGS: MirrorSettings = {
  liveMirror: true,
  fullscreenMode: "mirror",
  source: "live",
  lookId: null,
  artStyle: "oil",
  frame: "gilded",
  layout: "fill",
  plaqueTitle: "Portrait",
  plaqueSubtitle: "",
  showClock: false,
  idleMinutes: 0,
  stylistModel: null,
  speakReplies: true,
};

export const ART_STYLES: Array<{ id: ArtStyle; label: string; medium: string }> = [
  { id: "oil", label: "Oil painting", medium: "Oil on canvas" },
  { id: "watercolor", label: "Watercolour", medium: "Watercolour on paper" },
  { id: "charcoal", label: "Charcoal", medium: "Charcoal on paper" },
  { id: "vintage", label: "Vintage print", medium: "Silver gelatin print" },
  { id: "photo", label: "Photograph", medium: "Photograph" },
];

export const FRAMES: Array<{ id: FrameStyle; label: string }> = [
  { id: "gilded", label: "Gilded" },
  { id: "walnut", label: "Walnut" },
  { id: "modern", label: "Gallery black" },
  { id: "none", label: "Unframed" },
];

const KEY = "sm:settings";
const PHOTO_KEY = "sm:portraitPhoto";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function readSettings(): MirrorSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<MirrorSettings>) };
    // Migrate the earlier home-screen toggle.
    const legacy = localStorage.getItem("sm:liveMirror");
    if (legacy !== null) return { ...DEFAULT_SETTINGS, liveMirror: legacy === "1" };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS;
}

export function writeSettings(patch: Partial<MirrorSettings>): MirrorSettings {
  const next = { ...readSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  emit();
  return next;
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("sm:liveMirror");
  } catch {
    /* storage unavailable */
  }
  emit();
}

/** Settings hook; `ready` is false until localStorage has been read. */
export function useSettings() {
  const [settings, setSettings] = useState<MirrorSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const refresh = () => setSettings(readSettings());
    refresh();
    setReady(true);
    listeners.add(refresh);
    window.addEventListener("storage", refresh);
    return () => {
      listeners.delete(refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const update = useCallback((patch: Partial<MirrorSettings>) => setSettings(writeSettings(patch)), []);
  return { settings, update, ready };
}

/** A favourite photo chosen for the painting, kept only on this screen. */
export function readPortraitPhoto(): string | null {
  try {
    return localStorage.getItem(PHOTO_KEY);
  } catch {
    return null;
  }
}

export function writePortraitPhoto(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(PHOTO_KEY, dataUrl);
    else localStorage.removeItem(PHOTO_KEY);
    emit();
    return true;
  } catch {
    return false;
  }
}

export function usePortraitPhoto(): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setPhoto(readPortraitPhoto());
    refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, []);
  return photo;
}
