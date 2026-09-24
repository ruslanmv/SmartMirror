"use client";

import { Button, Icon } from "@smartmirror/ui";

import type { OutfitSession } from "@/lib/storage";

export interface StylistNoteData {
  reply: string;
  persona: { id: string; name: string };
  grounded: boolean;
  /** The wardrobe tools failed; the persona gave general advice. */
  toolsDown?: boolean;
}

/** The owned items of the top outfit, as the persona's grounding block. */
export function groundingFor(session: OutfitSession | null) {
  const top = session?.outfits[0];
  if (!session || !top) return [];
  return top.item_ids.flatMap((id) => {
    const it = session.items.find((i) => i.id === id);
    if (!it) return [];
    const name =
      (typeof it.metadata?.name === "string" && it.metadata.name) ||
      [it.color, it.subcategory || it.category].filter(Boolean).join(" ") ||
      it.category;
    return [{ id: it.id, name, category: it.category, color: it.color ?? undefined }];
  });
}

export function StylistNote({
  note,
  thinking,
  error,
  onReplay,
}: {
  note: StylistNoteData | null;
  thinking: boolean;
  error: string | null;
  onReplay?: () => void;
}) {
  return (
    <aside className="stylist-note" aria-live="polite" aria-busy={thinking}>
      <div className="stylist-note__avatar" aria-hidden>
        <Icon name="sparkle" />
      </div>
      <div className="stylist-note__body">
        <p className="stylist-note__who">{note?.persona.name ?? "Your stylist"}</p>
        {thinking ? (
          <p className="stylist-note__text stylist-note__text--muted">
            <span className="sm-spinner" /> Thinking it over…
          </p>
        ) : error ? (
          <p className="stylist-note__text stylist-note__text--muted">{error}</p>
        ) : note ? (
          <>
            <p className="stylist-note__text">{note.reply}</p>
            {note.toolsDown && (
              <p className="sm-faint stylist-note__hint">Your wardrobe isn’t connected yet, so this is general advice.</p>
            )}
          </>
        ) : null}
      </div>
      {note && onReplay && (
        <Button iconOnly size="sm" variant="ghost" icon="speaker" aria-label="Read it again" onClick={onReplay} />
      )}
    </aside>
  );
}
