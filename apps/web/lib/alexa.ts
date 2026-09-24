"use client";

import type { AlexaDirective } from "@smartmirror/device-capabilities";

/**
 * Alexa Web API for Games (Alexa.Presentation.HTML) client.
 *
 * The skill launches https://<deployment>/alexa with
 * Alexa.Presentation.HTML.Start; the page then creates the Alexa client and
 * receives intents from the skill through HandleMessage directives.
 */

export const ALEXA_SDK_URL = "https://cdn.html.games.alexa.a2z.com/alexa-html/latest/alexa-html.js";

interface AlexaClient {
  skill: {
    onMessage(cb: (message: unknown) => void): void;
    sendMessage(message: unknown, cb?: (result: { statusCode: number; reason?: string }) => void): void;
  };
  capabilities?: { microphone?: { supportsPushToTalk?: boolean; supportsWakeWord?: boolean } };
}

declare global {
  interface Window {
    Alexa?: {
      create(options: { version: string }): Promise<{ alexa: AlexaClient; message?: unknown }>;
    };
  }
}

let client: AlexaClient | null = null;
let starting: Promise<AlexaClient> | null = null;
let startMessage: AlexaDirective | null = null;
const handlers = new Set<(d: AlexaDirective) => void>();

function toDirective(message: unknown): AlexaDirective | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  if (typeof m.intent !== "string") return null;
  return { intent: m.intent as AlexaDirective["intent"], prompt: typeof m.prompt === "string" ? m.prompt : undefined };
}

function loadSdk(): Promise<void> {
  if (window.Alexa) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ALEXA_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Alexa SDK could not be loaded"));
    document.head.appendChild(script);
  });
}

/** Resolves only on an Alexa device; rejects in a normal browser. */
export function startAlexa(timeoutMs = 8_000): Promise<AlexaClient> {
  if (client) return Promise.resolve(client);
  starting ??= Promise.race([
    loadSdk().then(async () => {
      const created = await window.Alexa!.create({ version: "1.1" });
      client = created.alexa;
      startMessage = toDirective(created.message);
      client.skill.onMessage((msg) => {
        const d = toDirective(msg);
        if (d) for (const h of handlers) h(d);
      });
      return client;
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Alexa client did not start")), timeoutMs)),
  ]).catch((err) => {
    starting = null;
    throw err;
  });
  return starting;
}

export function isAlexaActive(): boolean {
  return client !== null;
}

/** The directive the skill passed in Alexa.Presentation.HTML.Start, consumed once. */
export function takeStartDirective(): AlexaDirective | null {
  const d = startMessage;
  startMessage = null;
  return d;
}

export function onAlexaDirective(handler: (d: AlexaDirective) => void): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Tell the skill what the screen is doing, so it can speak an answer. */
export function sendToSkill(message: Record<string, unknown>) {
  client?.skill.sendMessage(message);
}
