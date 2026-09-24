"use client";

import type { RemoteKey } from "@smartmirror/device-capabilities";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useDevice } from "@/lib/capabilities";

/**
 * Spatial navigation for remote controls. Arrow keys move focus to the
 * nearest focusable element in that direction; OK/Enter activates it; Back
 * returns to the previous screen. The Echo shell forwards D-pad key events to
 * the WebView as ordinary arrow keys, so the same code serves both.
 *
 * Mark the element that should receive focus on screen entry with
 * `data-autofocus`. Scope navigation to an overlay with `data-dpad-scope`.
 */

type Direction = "up" | "down" | "left" | "right";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(", ");

function visible(el: HTMLElement): boolean {
  if (el.closest("[inert], [aria-hidden='true']")) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function scopeRoot(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>("[data-dpad-scope]");
  return scopes.length ? scopes[scopes.length - 1]! : document;
}

// The element the remote last focused. When the WebView/iframe loses window
// focus, document.activeElement falls back to <body>; navigation resumes here.
let lastFocused: HTMLElement | null = null;

function currentFocus(all: HTMLElement[]): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && all.includes(active)) return active;
  if (lastFocused?.isConnected && all.includes(lastFocused)) return lastFocused;
  return null;
}

function candidates(): HTMLElement[] {
  return Array.from(scopeRoot().querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

export function focusFirst(): boolean {
  const root = scopeRoot();
  const preferred = root.querySelector<HTMLElement>("[data-autofocus]");
  const target = preferred && visible(preferred) ? preferred : candidates()[0];
  if (!target) return false;
  target.focus({ preventScroll: false });
  return true;
}

function move(direction: Direction): boolean {
  const all = candidates();
  const current = currentFocus(all);
  if (!current) return focusFirst();

  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let primary: number;
    let secondary: number;
    switch (direction) {
      case "up":
        if (r.bottom > from.top + 1) continue;
        primary = from.top - r.bottom;
        secondary = Math.abs(x - fx);
        break;
      case "down":
        if (r.top < from.bottom - 1) continue;
        primary = r.top - from.bottom;
        secondary = Math.abs(x - fx);
        break;
      case "left":
        if (r.right > from.left + 1) continue;
        primary = from.left - r.right;
        secondary = Math.abs(y - fy);
        break;
      case "right":
        if (r.left < from.right - 1) continue;
        primary = r.left - from.right;
        secondary = Math.abs(y - fy);
        break;
    }
    // Prefer elements that overlap on the cross axis (same row/column).
    const overlaps =
      direction === "up" || direction === "down"
        ? r.left < from.right && r.right > from.left
        : r.top < from.bottom && r.bottom > from.top;
    const score = Math.max(0, primary) + secondary * (overlaps ? 0.5 : 2.5);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function isTextEntry(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["button", "submit", "checkbox", "radio", "range", "file"].includes(el.type);
}

export function DPadFocus() {
  const { capabilities } = useDevice();
  const router = useRouter();
  const pathname = usePathname();
  const enabled = capabilities.dpad;

  useEffect(() => {
    if (!enabled) return;

    const back = () => {
      const overlayClose = document.querySelector<HTMLElement>("[data-dpad-scope] [data-dpad-back]");
      if (overlayClose) overlayClose.click();
      else if (window.location.pathname !== "/smartmirror") router.back();
    };

    const handle = (key: RemoteKey | string, event?: KeyboardEvent) => {
      const active = document.activeElement;
      const direction = KEY_TO_DIRECTION[key];
      if (direction) {
        // Let text fields keep left/right for the caret.
        if (isTextEntry(active) && (direction === "left" || direction === "right")) {
          const { selectionStart, selectionEnd, value } = active;
          const atStart = selectionStart === 0 && selectionEnd === 0;
          const atEnd = selectionStart === value.length;
          if ((direction === "left" && !atStart) || (direction === "right" && !atEnd)) return;
        }
        if (move(direction)) event?.preventDefault();
        return;
      }
      if (key === "Enter" && !event) {
        currentFocus(candidates())?.click();
        return;
      }
      if (key === "Back" || key === "Escape" || key === "GoBack" || key === "BrowserBack") {
        event?.preventDefault();
        back();
        return;
      }
      if (key === "Backspace" && !isTextEntry(active)) {
        event?.preventDefault();
        back();
        return;
      }
      if (key === "Home") {
        router.push("/smartmirror");
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      handle(e.key, e);
    };
    const onRemote = (e: Event) => handle((e as CustomEvent<RemoteKey>).detail);

    window.addEventListener("keydown", onKey);
    window.addEventListener("sm:remote-key", onRemote);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sm:remote-key", onRemote);
    };
  }, [enabled, router]);

  // Put focus somewhere sensible on every screen so the remote always works.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(focusFirst, 120);
    return () => window.clearTimeout(id);
  }, [enabled, pathname]);

  // Move focus into overlays as they open.
  useEffect(() => {
    if (!enabled) return;
    let scopes = document.querySelectorAll("[data-dpad-scope]").length;
    const observer = new MutationObserver(() => {
      const count = document.querySelectorAll("[data-dpad-scope]").length;
      if (count > scopes) window.setTimeout(focusFirst, 30);
      scopes = count;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);

  // If the focused element disappears (list re-render, closed overlay), recover.
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && e.target !== document.body) lastFocused = e.target;
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Only the window blurred (e.g. the simulator panel was clicked): keep our place.
        if (!document.hasFocus() && lastFocused?.isConnected) return;
        if (document.activeElement === document.body || !document.activeElement) focusFirst();
      }, 60);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return null;
}
