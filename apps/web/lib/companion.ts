"use client";

/**
 * Companion-phone capture handoff.
 *
 * The screen shows a QR code for /companion/<code>; the phone takes the photo
 * and hands it back. Today the handoff uses BroadcastChannel, which works
 * whenever both views share a browser (the simulator's phone preview, or two
 * tabs). Cross-device delivery goes through OllaBridge's relay once its
 * generic "device message" channel exists; the code below is the only place
 * that needs to change.
 */

export interface CompanionMessage {
  type: "photo";
  dataUrl: string;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newCompanionCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function channel(code: string): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`smartmirror-companion-${code}`);
}

export function listenForCompanionPhoto(code: string, onPhoto: (dataUrl: string) => void): () => void {
  const ch = channel(code);
  if (!ch) return () => {};
  ch.onmessage = (e: MessageEvent<CompanionMessage>) => {
    if (e.data?.type === "photo" && typeof e.data.dataUrl === "string" && e.data.dataUrl.startsWith("data:image/")) {
      onPhoto(e.data.dataUrl);
    }
  };
  return () => ch.close();
}

export function sendCompanionPhoto(code: string, dataUrl: string): boolean {
  const ch = channel(code);
  if (!ch) return false;
  ch.postMessage({ type: "photo", dataUrl } satisfies CompanionMessage);
  ch.close();
  return true;
}
