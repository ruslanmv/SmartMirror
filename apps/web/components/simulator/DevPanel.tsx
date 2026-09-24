"use client";

import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  type AlexaDirective,
  type CapabilityKey,
  type DeviceCapabilities,
  type RemoteKey,
} from "@smartmirror/device-capabilities";
import { Button, Chip, Icon } from "@smartmirror/ui";
import { useState, type FormEvent, type ReactNode } from "react";

export function PanelSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sim-section">
      <header className="sim-section__head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function CapabilityToggles({
  capabilities,
  defaults,
  onChange,
}: {
  capabilities: DeviceCapabilities;
  defaults: DeviceCapabilities;
  onChange: (key: CapabilityKey, value: boolean) => void;
}) {
  return (
    <ul className="sim-toggles">
      {CAPABILITY_KEYS.map((key) => {
        const on = capabilities[key];
        const changed = on !== defaults[key];
        return (
          <li key={key}>
            <label className="sim-toggle">
              <span className="sim-toggle__text">
                <span className="sim-toggle__label">
                  {CAPABILITY_LABELS[key].label}
                  {changed && <span className="sim-toggle__changed" title="Differs from profile default" />}
                </span>
                <span className="sim-toggle__hint">{CAPABILITY_LABELS[key].hint}</span>
              </span>
              <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(key, e.target.checked)} />
              <span className="sim-switch" aria-hidden="true" />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function Remote({ onKey, disabled }: { onKey: (key: RemoteKey) => void; disabled?: boolean }) {
  const b = (key: RemoteKey, icon: Parameters<typeof Icon>[0]["name"], label: string, cls: string) => (
    <button type="button" className={`sim-remote__btn ${cls}`} onClick={() => onKey(key)} aria-label={label} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
  return (
    <div className="sim-remote">
      <div className="sim-remote__pad">
        {b("ArrowUp", "chevron-up", "Up", "is-up")}
        {b("ArrowLeft", "chevron-left", "Left", "is-left")}
        <button type="button" className="sim-remote__ok" onClick={() => onKey("Enter")} disabled={disabled}>
          OK
        </button>
        {b("ArrowRight", "chevron-right", "Right", "is-right")}
        {b("ArrowDown", "chevron-down", "Down", "is-down")}
      </div>
      <div className="sim-remote__row">
        <Button size="sm" icon="back" onClick={() => onKey("Back")} disabled={disabled}>
          Back
        </Button>
        <Button size="sm" icon="home" onClick={() => onKey("Home")} disabled={disabled}>
          Home
        </Button>
      </div>
    </div>
  );
}

const SAMPLES = [
  "what should I wear to dinner tonight",
  "something for the office",
  "show my wardrobe",
  "take my photo",
  "show my portrait",
  "try it on",
];

export function parseUtterance(text: string): AlexaDirective {
  const t = text.toLowerCase().replace(/^alexa,?\s*(ask|tell|open)\s+smart\s*mirror\s*(to|for|what)?\s*/i, "").trim();
  if (!t || /^(open|launch|start)$/.test(t)) return { intent: "LaunchRequest" };
  if (/wardrobe|closet|my clothes/.test(t)) return { intent: "WardrobeIntent" };
  if (/portrait|painting|mirror mode|be a mirror|fill (the )?screen/.test(t)) return { intent: "PortraitIntent" };
  if (/photo|picture|selfie/.test(t)) return { intent: "PhotoIntent" };
  if (/try (it|this|that) on|try on/.test(t)) return { intent: "TryOnIntent" };
  if (/^(go )?home$/.test(t)) return { intent: "HomeIntent" };
  return { intent: "StyleIntent", prompt: t.replace(/^(what should i wear|what to wear|something)\s*(to|for)?\s*/i, "").trim() || t };
}

export function AlexaConsole({ enabled, onDirective }: { enabled: boolean; onDirective: (d: AlexaDirective, utterance: string) => void }) {
  const [text, setText] = useState("");
  const send = (utterance: string) => {
    if (!utterance.trim()) return;
    onDirective(parseUtterance(utterance), utterance);
    setText("");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };
  if (!enabled) {
    return <p className="sim-muted">Turn on the Alexa capability to simulate an Alexa.Presentation.HTML session.</p>;
  }
  return (
    <div className="sim-alexa">
      <form className="sim-alexa__form" onSubmit={submit}>
        <span className="sim-alexa__prefix">Alexa, ask Smart Mirror</span>
        <input className="sm-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="for a dinner outfit" />
        <Button type="submit" size="sm" variant="primary" iconOnly icon="arrow-right" aria-label="Send utterance" />
      </form>
      <div className="sim-chips">
        {SAMPLES.map((s) => (
          <Chip key={s} onClick={() => send(s)}>
            {s}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export interface LogEntry {
  id: number;
  at: number;
  dir: "in" | "out" | "sys";
  text: string;
}

export function EventLog({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  return (
    <div className="sim-log">
      <div className="sim-log__list" role="log" aria-live="polite">
        {entries.length === 0 && <p className="sim-muted">Bridge traffic between the simulator and the device appears here.</p>}
        {entries.map((e) => (
          <div key={e.id} className={`sim-log__row is-${e.dir}`}>
            <time>{new Date(e.at).toLocaleTimeString([], { hour12: false })}</time>
            <span className="sim-log__dir">{e.dir === "in" ? "←" : e.dir === "out" ? "→" : "•"}</span>
            <span>{e.text}</span>
          </div>
        ))}
      </div>
      {entries.length > 0 && (
        <button type="button" className="sim-link" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}
