"use client";

import { useEffect, useState } from "react";

import { getCapture, getLooks, subscribeStorage, type SavedLook, type StoredCapture } from "./storage";

function useStored<T>(read: () => T, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    setValue(read());
    const refresh = () => setValue(read());
    const unsubscribe = subscribeStorage(refresh);
    window.addEventListener("storage", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", refresh);
    };
  }, [read]);
  return value;
}

export function useCapture(): StoredCapture | null {
  return useStored(getCapture, null);
}

export function useLooks(): SavedLook[] {
  return useStored(getLooks, [] as SavedLook[]);
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
