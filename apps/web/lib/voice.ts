"use client";

import { sendToSkill } from "@/lib/alexa";

/**
 * Say something out loud on whatever this screen is: inside an Alexa HTML
 * session the skill speaks it (so it uses Alexa's voice and does not talk over
 * her); elsewhere the browser's speech synthesis does.
 */
export function speak(text: string, runtime: string): void {
  if (!text) return;
  if (runtime === "alexa-html") {
    sendToSkill({ speech: text });
    return;
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || "en-US";
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is a nicety; never break the screen for it */
  }
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
