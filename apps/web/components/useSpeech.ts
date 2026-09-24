"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Minimal Web Speech wrapper used when the device exposes a microphone. */
export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<RecognitionLike | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => setSupported(ctor() !== null), []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;
    const r = new C();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        text += res[0]?.transcript ?? "";
        final ||= res.isFinal;
      }
      setInterim(text);
      if (final) cb.current(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setInterim("");
    setListening(true);
    r.start();
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  useEffect(() => () => rec.current?.stop(), []);

  return { supported, listening, interim, start, stop };
}
