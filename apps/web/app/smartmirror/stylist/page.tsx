"use client";

import { Button, Chip, Icon } from "@smartmirror/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { OutfitCard } from "@/components/OutfitCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { useSpeech } from "@/components/useSpeech";
import { ApiError, api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";
import { getOutfitSession, saveLook, saveOutfitSession, type OutfitSession } from "@/lib/storage";
import { useLooks } from "@/lib/use-local";

const OCCASIONS = ["Dinner", "Date night", "Office", "Brunch", "Party", "Wedding guest", "Travel", "Weekend"];
const MOODS = ["Elegant", "Relaxed", "Minimal", "Bold", "Sexy", "Sporty"];
const COLORS = ["Black", "Ivory", "Beige", "Navy", "Emerald", "Burgundy"];

export default function StylistPage() {
  return (
    <Suspense>
      <Stylist />
    </Suspense>
  );
}

function Stylist() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { capabilities, runtime } = useDevice();
  const looks = useLooks();

  const [prompt, setPrompt] = useState(params.get("prompt") ?? "");
  const [occasion, setOccasion] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [session, setSession] = useState<OutfitSession | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    if (!params.get("prompt")) setSession(getOutfitSession());
  }, [params]);

  const composed = useCallback(
    (base: string) => {
      const extra = [occasion && `for ${occasion.toLowerCase()}`, mood && `${mood.toLowerCase()} feel`, color && `in ${color.toLowerCase()}`]
        .filter(Boolean)
        .join(", ");
      return [base.trim(), extra].filter(Boolean).join(" — ") || "Something I’d love to wear today";
    },
    [occasion, mood, color],
  );

  const run = useCallback(
    async (text: string) => {
      const full = composed(text);
      setBusy(true);
      setError(null);
      try {
        const [result, items] = await Promise.all([api.suggest(full, 3), api.wardrobe()]);
        const next = { prompt: full, outfits: result.outfits, items };
        setSession(next);
        saveOutfitSession(next);
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError("Something went wrong", 500, "error"));
      } finally {
        setBusy(false);
      }
    },
    [composed],
  );

  useEffect(() => {
    const p = params.get("prompt");
    if (p && params.get("auto") === "1" && !autoRan.current) {
      autoRan.current = true;
      setPrompt(p);
      void run(p);
    }
  }, [params, run]);

  const speech = useSpeech((text) => {
    setPrompt(text);
    void run(text);
  });
  const canSpeak = capabilities.microphone && speech.supported && runtime !== "alexa-html";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(prompt);
  };

  const savedIds = new Set(looks.map((l) => l.outfit.id));

  return (
    <div className="screen">
      <ScreenHeader
        title="Ask your stylist"
        subtitle="Suggestions come only from pieces you actually own."
      />
      <div className="stylist">
        <form className="sm-panel prompt-panel" onSubmit={onSubmit}>
          <h2 className="prompt-panel__title">Describe the moment</h2>
          <div className="prompt-row">
            <label className="visually-hidden" htmlFor="prompt">
              What are you dressing for?
            </label>
            <input
              id="prompt"
              className="sm-input"
              placeholder="e.g. rooftop dinner, a little cold"
              value={speech.listening ? speech.interim : prompt}
              onChange={(e) => setPrompt(e.target.value)}
              autoComplete="off"
              enterKeyHint="go"
            />
            <Button type="submit" variant="primary" icon="sparkle" busy={busy} data-autofocus={!session || undefined}>
              {busy ? "Styling…" : "Suggest"}
            </Button>
            {canSpeak && (
              <Button
                iconOnly
                icon="mic"
                variant={speech.listening ? "primary" : "default"}
                aria-label={speech.listening ? "Stop listening" : "Speak your request"}
                onClick={speech.listening ? speech.stop : speech.start}
              />
            )}
          </div>
          {speech.listening && (
            <span className="listening">
              <span className="listening__dot" /> Listening…
            </span>
          )}

          <ChipGroup label="Occasion" options={OCCASIONS} value={occasion} onChange={setOccasion} />
          <ChipGroup label="Mood" options={MOODS} value={mood} onChange={setMood} />
          <ChipGroup label="Colour" options={COLORS} value={color} onChange={setColor} />

          {capabilities.alexa && (
            <p className="sm-faint" style={{ fontSize: "0.85rem" }}>
              <Icon name="alexa" width="1em" height="1em" style={{ display: "inline", verticalAlign: "-0.15em" }} /> You can also say
              “Alexa, ask Smart Mirror what to wear to the office”.
            </p>
          )}
        </form>

        <section className="scroll-area" aria-live="polite" aria-busy={busy}>
          <div className="results">
            {params.get("from") === "snap" && (
              <div className="banner banner--info" style={{ margin: 0 }}>
                <Icon name="camera" />
                <span>
                  <b>Your new photo is ready.</b> Pick an occasion, then press <b>Try it on</b> to see the outfit on you.
                </span>
              </div>
            )}
            {error ? (
              <div className="empty">
                <div className="empty__icon">
                  <Icon name={error.needsPairing ? "link" : "refresh"} />
                </div>
                <p className="empty__title">{error.needsPairing ? "Pair this screen first" : "Couldn’t reach your stylist"}</p>
                <p>{error.message}</p>
                {error.needsPairing ? (
                  <Button variant="primary" onClick={() => router.push("/smartmirror/pairing")}>
                    Pair screen
                  </Button>
                ) : (
                  <Button onClick={() => void run(prompt)} icon="refresh">
                    Try again
                  </Button>
                )}
              </div>
            ) : busy ? (
              [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: "14rem" }} />)
            ) : session && session.outfits.length ? (
              <>
                <p className="results__meta">
                  <Icon name="sparkle" width="1.1em" height="1.1em" /> {session.outfits.length} looks for “{session.prompt}”
                </p>
                {session.outfits.map((outfit, i) => (
                  <OutfitCard
                    key={outfit.id}
                    outfit={outfit}
                    items={session.items}
                    index={i}
                    autoFocus={i === 0}
                    saved={savedIds.has(outfit.id)}
                    onTryOn={() => router.push(`/smartmirror/tryon?outfit=${encodeURIComponent(outfit.id)}`)}
                    onSave={() => {
                      saveLook({
                        title: outfit.title ?? `Look ${i + 1}`,
                        prompt: session.prompt,
                        outfit,
                        items: session.items.filter((it) => outfit.item_ids.includes(it.id)),
                      });
                      toast("Saved to Recent looks");
                    }}
                  />
                ))}
              </>
            ) : session ? (
              <div className="empty">
                <div className="empty__icon">
                  <Icon name="hanger" />
                </div>
                <p className="empty__title">Your wardrobe is empty</p>
                <p>Add a few pieces and your stylist will build outfits from them.</p>
                <Button variant="primary" onClick={() => router.push("/smartmirror/wardrobe")}>
                  Open wardrobe
                </Button>
              </div>
            ) : (
              <div className="empty">
                <div className="empty__icon">
                  <Icon name="sparkle" />
                </div>
                <p className="empty__title">Tell me where you’re going</p>
                <p>Pick an occasion and a mood, or type a few words. I’ll pull complete outfits from your wardrobe.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="chip-group" role="group" aria-label={label}>
      <span className="chip-group__label">{label}</span>
      {options.map((o) => (
        <Chip key={o} pressed={value === o} onClick={() => onChange(value === o ? null : o)}>
          {o}
        </Chip>
      ))}
    </div>
  );
}
