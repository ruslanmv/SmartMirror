"use client";

import { Button, Chip, Icon } from "@smartmirror/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { CompleteTheLook } from "@/components/CompleteTheLook";
import { OutfitCard } from "@/components/OutfitCard";
import { StylistNote, groundingFor, type StylistNoteData } from "@/components/StylistNote";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { useSpeech } from "@/components/useSpeech";
import { ApiError, api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";
import { readSettings, useSettings } from "@/lib/settings";
import { getOutfitSession, saveLook, saveOutfitSession, type OutfitSession } from "@/lib/storage";
import { useLooks } from "@/lib/use-local";
import { speak } from "@/lib/voice";

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
  const { settings } = useSettings();
  const [planning, setPlanning] = useState<"week" | "trip" | null>(null);

  const [prompt, setPrompt] = useState(params.get("prompt") ?? "");
  const [occasion, setOccasion] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [session, setSession] = useState<OutfitSession | null>(null);
  const [note, setNote] = useState<StylistNoteData | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
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
      setNote(null);
      setNoteError(null);
      // 1) Outfits from the owner's real wardrobe (MCP tools).
      let next: OutfitSession | null = null;
      let toolError: ApiError | null = null;
      try {
        const [result, items] = await Promise.all([api.suggest(full, 3), api.wardrobe()]);
        next = { prompt: full, outfits: result.outfits, items, gaps: result.gaps ?? [] };
        setSession(next);
        saveOutfitSession(next);
      } catch (err) {
        toolError = err instanceof ApiError ? err : new ApiError("Something went wrong", 500, "error");
      } finally {
        setBusy(false);
      }
      if (toolError?.needsPairing) return setError(toolError);

      // 2) The HomePilot Stylist persona says it in a sentence or two,
      //    grounded in the top outfit's owned items.
      setThinking(true);
      // Read at call time: auto-run (Alexa, quick ideas) can fire before settings hydrate.
      const settings = readSettings();
      try {
        const r = await api.stylistChat({ prompt: full, items: groundingFor(next), model: settings.stylistModel });
        setNote({ ...r, toolsDown: Boolean(toolError) });
        if (toolError) setSession(null);
        if (settings.speakReplies) speak(r.reply, runtime);
      } catch (err) {
        if (toolError) setError(toolError);
        else if (!(err instanceof ApiError && err.code === "unavailable")) {
          setNoteError(err instanceof ApiError ? err.message : "Your stylist could not answer");
        }
      } finally {
        setThinking(false);
      }
    },
    [composed, runtime],
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

  // Sets (W-5): a look per day, rotating pieces; saved on the owner's PC.
  const plan = async (kind: "week" | "trip") => {
    setPlanning(kind);
    try {
      const text = prompt.trim() || occasion || (kind === "week" ? "office" : "travel");
      const set = await api.planSet(kind, kind === "week" ? 5 : 3, composed(text));
      router.push(`/smartmirror/looks?set=${encodeURIComponent(set.id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.needsPairing) setError(err);
      else toast(err instanceof ApiError ? err.message : "Could not plan outfits", { tone: "warn" });
    } finally {
      setPlanning(null);
    }
  };

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

          <div className="plan-row" role="group" aria-label="Plan ahead">
            <span className="chip-group__label">Plan ahead</span>
            <Button size="sm" icon="looks" busy={planning === "week"} disabled={planning !== null} onClick={() => void plan("week")}>
              Plan my week
            </Button>
            <Button size="sm" icon="looks" busy={planning === "trip"} disabled={planning !== null} onClick={() => void plan("trip")}>
              Pack for a trip
            </Button>
          </div>

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
            {(note || thinking || noteError) && !error && (
              <StylistNote
                note={note}
                thinking={thinking}
                error={noteError}
                onReplay={note ? () => speak(note.reply, runtime) : undefined}
              />
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
                {settings.shoppingSuggestions && <CompleteTheLook gaps={session.gaps ?? []} />}
              </>
            ) : note?.toolsDown ? null : session ? (
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
            ) : thinking || note ? null : (
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
