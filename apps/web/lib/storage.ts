"use client";

import type { OutfitCandidate, WardrobeItem } from "./tools";

/**
 * Device-local storage. Body captures stay on this screen (and are only sent
 * to the owner's own backend for a try-on), expire like the backend's
 * SMARTMIRROR_BODY_CAPTURE_TTL_HOURS, and can be deleted at any time.
 */

const CAPTURE_KEY = "sm:capture";
const LOOKS_KEY = "sm:looks";
const OUTFITS_KEY = "sm:outfits";
const CAPTURE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LOOKS = 24;

export interface StoredCapture {
  dataUrl: string;
  source: string;
  takenAt: number;
}

export interface SavedLook {
  id: string;
  title: string;
  prompt?: string;
  outfit: OutfitCandidate;
  items: WardrobeItem[];
  /** Try-on preview (data URL) if one was rendered. */
  preview?: string | null;
  savedAt: number;
}

export interface OutfitSession {
  prompt: string;
  outfits: OutfitCandidate[];
  items: WardrobeItem[];
}

function read<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
export function subscribeStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCapture(): StoredCapture | null {
  const c = read<StoredCapture>(local(), CAPTURE_KEY);
  if (c && Date.now() - c.takenAt > CAPTURE_TTL_MS) {
    clearCapture();
    return null;
  }
  return c;
}

export function saveCapture(dataUrl: string, source: string): StoredCapture {
  const capture = { dataUrl, source, takenAt: Date.now() };
  write(local(), CAPTURE_KEY, capture);
  emit();
  return capture;
}

export function clearCapture() {
  try {
    local()?.removeItem(CAPTURE_KEY);
  } catch {
    /* storage unavailable */
  }
  emit();
}

export function getLooks(): SavedLook[] {
  return read<SavedLook[]>(local(), LOOKS_KEY) ?? [];
}

export function saveLook(look: Omit<SavedLook, "id" | "savedAt">): SavedLook {
  const entry: SavedLook = { ...look, id: `look_${Date.now().toString(36)}`, savedAt: Date.now() };
  let looks = [entry, ...getLooks().filter((l) => l.outfit.id !== look.outfit.id)].slice(0, MAX_LOOKS);
  // Previews are large; drop the oldest ones' images if storage is full.
  while (!write(local(), LOOKS_KEY, looks) && looks.some((l) => l.preview)) {
    const idx = looks.map((l) => Boolean(l.preview)).lastIndexOf(true);
    looks = looks.map((l, i) => (i === idx ? { ...l, preview: null } : l));
  }
  emit();
  return entry;
}

export function deleteLook(id: string) {
  write(local(), LOOKS_KEY, getLooks().filter((l) => l.id !== id));
  emit();
}

export function getOutfitSession(): OutfitSession | null {
  return read<OutfitSession>(session(), OUTFITS_KEY);
}

export function saveOutfitSession(value: OutfitSession) {
  write(session(), OUTFITS_KEY, value);
}
