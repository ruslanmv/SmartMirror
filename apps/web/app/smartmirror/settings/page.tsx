"use client";

import { downscaleImage } from "@smartmirror/device-capabilities";
import { Button, Chip, Icon, buttonClass } from "@smartmirror/ui";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";
import { ART_STYLES, FRAMES, resetSettings, usePortraitPhoto, useSettings, writePortraitPhoto, type PaintingSource } from "@/lib/settings";
import { useCapture, useLooks } from "@/lib/use-local";

import "./settings.css";

const SOURCES: Array<{ id: PaintingSource; label: string }> = [
  { id: "live", label: "Live camera" },
  { id: "latest", label: "Latest photo" },
  { id: "look", label: "Saved look" },
  { id: "custom", label: "A photo I love" },
];

const IDLE = [0, 2, 5, 10, 30];

export default function SettingsPage() {
  const toast = useToast();
  const { settings, update } = useSettings();
  const { capabilities, hasWebCamera } = useDevice();
  const custom = usePortraitPhoto();
  const capture = useCapture();
  const looks = useLooks();
  const file = useRef<HTMLInputElement>(null);
  const cameraOk = capabilities.camera && hasWebCamera;

  const onPhoto = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      const small = await downscaleImage(reader.result, 2000, 0.9);
      if (writePortraitPhoto(small)) {
        update({ source: "custom" });
        toast("Photo set as your portrait");
      } else {
        toast("That photo is too large to keep on this screen", { tone: "warn" });
      }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="screen">
      <ScreenHeader
        title="Settings"
        subtitle="How this screen looks when you are, and are not, standing in front of it."
        actions={
          <Link href="/smartmirror/portrait" className={buttonClass({ variant: "primary" })} data-autofocus>
            <Icon name="monitor" /> Fill screen
          </Link>
        }
      />
      <div className="scroll-area">
        <div className="settings">
          <Section title="Mirror" hint={cameraOk ? "Uses this device's camera; nothing is recorded or uploaded." : "No camera available on this device right now."}>
            <Row label="Live mirror on the home screen" hint="On by default: the arch shows you, like a real mirror.">
              <Toggle on={settings.liveMirror} onChange={(v) => update({ liveMirror: v })} />
            </Row>
          </Section>

          <StylistSection />

          <Section title="Fill screen" hint="Full-screen mode for a wall-mounted Echo Show.">
            <Row label="Show">
              <Chip pressed={settings.fullscreenMode === "mirror"} onClick={() => update({ fullscreenMode: "mirror" })}>
                Real mirror
              </Chip>
              <Chip pressed={settings.fullscreenMode === "painting"} onClick={() => update({ fullscreenMode: "painting" })}>
                Framed painting
              </Chip>
            </Row>
            <Row label="Start automatically" hint="After the home screen has been idle.">
              {IDLE.map((m) => (
                <Chip key={m} pressed={settings.idleMinutes === m} onClick={() => update({ idleMinutes: m })}>
                  {m === 0 ? "Never" : `${m} min`}
                </Chip>
              ))}
            </Row>
            <Row label="Clock">
              <Toggle on={settings.showClock} onChange={(v) => update({ showClock: v })} />
            </Row>
          </Section>

          <Section title="Painting" hint="Turn the screen into a portrait on your wall.">
            <Row label="Picture">
              {SOURCES.map((s) => (
                <Chip key={s.id} pressed={settings.source === s.id} onClick={() => update({ source: s.id })}>
                  {s.label}
                </Chip>
              ))}
            </Row>

            {settings.source === "look" && (
              <Row label="Saved look" hint={looks.some((l) => l.preview) ? undefined : "Save a try-on to use it as a painting."}>
                {looks
                  .filter((l) => l.preview)
                  .map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="settings-thumb"
                      aria-pressed={settings.lookId === l.id}
                      onClick={() => update({ lookId: l.id })}
                      aria-label={l.title}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                      <img src={l.preview!} alt="" />
                    </button>
                  ))}
              </Row>
            )}

            {settings.source === "custom" && (
              <Row label="A photo I love" hint="Stays on this screen only.">
                {custom && (
                  <span className="settings-thumb settings-thumb--static">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                    <img src={custom} alt="Chosen portrait photo" />
                  </span>
                )}
                <input ref={file} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
                <Button icon="upload" onClick={() => file.current?.click()}>
                  {custom ? "Change photo" : "Choose photo"}
                </Button>
                {capture && (
                  <Button
                    icon="camera"
                    onClick={() => {
                      writePortraitPhoto(capture.dataUrl);
                      toast("Latest photo set as your portrait");
                    }}
                  >
                    Use latest photo
                  </Button>
                )}
                {custom && (
                  <Button variant="ghost" icon="trash" onClick={() => writePortraitPhoto(null)}>
                    Remove
                  </Button>
                )}
              </Row>
            )}

            <Row label="Style">
              {ART_STYLES.map((s) => (
                <Chip key={s.id} pressed={settings.artStyle === s.id} onClick={() => update({ artStyle: s.id })}>
                  {s.label}
                </Chip>
              ))}
            </Row>
            <Row label="Frame">
              {FRAMES.map((f) => (
                <Chip key={f.id} pressed={settings.frame === f.id} onClick={() => update({ frame: f.id })}>
                  <span className={`frame-swatch frame-swatch--${f.id}`} aria-hidden="true" />
                  {f.label}
                </Chip>
              ))}
            </Row>
            <Row label="Layout">
              <Chip pressed={settings.layout === "fill"} onClick={() => update({ layout: "fill" })}>
                Fill the screen
              </Chip>
              <Chip pressed={settings.layout === "wall"} onClick={() => update({ layout: "wall" })}>
                Hung on a wall
              </Chip>
            </Row>
            <Row label="Plaque" hint="Shown under the painting when it hangs on a wall.">
              <input
                className="sm-input settings-input"
                value={settings.plaqueTitle}
                maxLength={60}
                onChange={(e) => update({ plaqueTitle: e.target.value })}
                aria-label="Plaque title"
                placeholder="Portrait of …"
              />
              <input
                className="sm-input settings-input"
                value={settings.plaqueSubtitle}
                maxLength={60}
                onChange={(e) => update({ plaqueSubtitle: e.target.value })}
                aria-label="Plaque subtitle"
                placeholder={`${ART_STYLES.find((s) => s.id === settings.artStyle)?.medium}, ${new Date().getFullYear()}`}
              />
            </Row>
          </Section>

          <div className="settings__footer">
            <Button
              variant="ghost"
              icon="refresh"
              onClick={() => {
                resetSettings();
                toast("Settings restored");
              }}
            >
              Restore defaults
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="sm-panel settings-section">
      <header>
        <h2 className="settings-section__title">{title}</h2>
        {hint && <p className="sm-faint">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="settings-switch" onClick={() => onChange(!on)}>
      <span className="settings-switch__track" aria-hidden="true" />
      {on ? "On" : "Off"}
    </button>
  );
}

/** Which HomePilot persona the stylist speaks through, and whether it reads answers aloud. */
function StylistSection() {
  const { settings, update } = useSettings();
  const [personas, setPersonas] = useState<{ id: string; name: string }[] | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .stylistPersonas()
      .then((r) => {
        setPersonas(r.personas);
        setSuggested(r.suggested);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load personas"));
  }, []);

  const current = settings.stylistModel ?? suggested;
  return (
    <Section title="Stylist" hint="Answers come from a persona on your own HomePilot, through OllaBridge.">
      <Row
        label="Persona"
        hint={
          error ??
          (personas && !personas.length
            ? "No persona is published yet. Import stylist.hpersona in HomePilot and publish it with the alias “stylist”."
            : "Pick who answers. “Automatic” uses the persona published as “stylist”.")
        }
      >
        <Chip pressed={settings.stylistModel === null} onClick={() => update({ stylistModel: null })}>
          Automatic
        </Chip>
        {(personas ?? []).map((p) => (
          <Chip key={p.id} pressed={settings.stylistModel === p.id} onClick={() => update({ stylistModel: p.id })}>
            {p.name}
            {p.id === current && settings.stylistModel === null ? " ✓" : ""}
          </Chip>
        ))}
      </Row>
      <Row label="Read answers aloud" hint="On an Echo Show inside Alexa, Alexa speaks the answer.">
        <Toggle on={settings.speakReplies} onChange={(v) => update({ speakReplies: v })} />
      </Row>
      <Row
        label="Shopping suggestions"
        hint="When your wardrobe is missing a piece, show where to buy it as a QR code for your phone. Your PC must allow it (SMARTMIRROR_SHOPPING=linkout)."
      >
        <Toggle on={settings.shoppingSuggestions} onChange={(v) => update({ shoppingSuggestions: v })} />
      </Row>
    </Section>
  );
}
