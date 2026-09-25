"use client";

import { Button, GarmentSwatch } from "@smartmirror/ui";

import type { OutfitCandidate, WardrobeItem } from "@/lib/tools";

export function itemName(item: WardrobeItem): string {
  return item.metadata?.name ?? [item.color, item.subcategory ?? item.category].filter(Boolean).join(" ");
}

export function SwatchTile({ item }: { item: WardrobeItem }) {
  return (
    <div className="swatch-tile">
      <GarmentSwatch
        // Subcategory first: canonical categories are broad ("bottom" may be a skirt).
        category={[item.subcategory, item.category].filter(Boolean).join(" ")}
        color={item.color}
        imageUrl={typeof item.metadata?.image_url === "string" ? item.metadata.image_url : null}
        label={itemName(item)}
      />
    </div>
  );
}

export interface OutfitCardProps {
  outfit: OutfitCandidate;
  items: WardrobeItem[];
  index: number;
  onTryOn?: () => void;
  onSave?: () => void;
  saved?: boolean;
  autoFocus?: boolean;
}

export function OutfitCard({ outfit, items, index, onTryOn, onSave, saved, autoFocus }: OutfitCardProps) {
  const pieces = outfit.item_ids.map((id) => items.find((i) => i.id === id)).filter((i): i is WardrobeItem => Boolean(i));
  return (
    <article className="outfit" aria-label={outfit.title ?? `Outfit ${index + 1}`}>
      <div className="outfit__collage">
        {pieces.slice(0, 5).map((item) => (
          <SwatchTile key={item.id} item={item} />
        ))}
      </div>
      <div className="outfit__body">
        <div className="outfit__head">
          <h2 className="outfit__title">{outfit.title ?? `Look ${index + 1}`}</h2>
          <span className="outfit__score">{Math.round(outfit.score * 100)}% match</span>
        </div>
        <p className="outfit__explanation">{outfit.explanation}</p>
        <div className="outfit__items">
          {pieces.map((item) => (
            <span key={item.id} className="outfit__item">
              {itemName(item)}
            </span>
          ))}
        </div>
        <div className="outfit__actions">
          {onTryOn && (
            <Button variant="primary" icon="wand" onClick={onTryOn} data-autofocus={autoFocus || undefined}>
              Try it on
            </Button>
          )}
          {onSave && (
            <Button icon={saved ? "check" : "plus"} onClick={onSave} disabled={saved}>
              {saved ? "Saved" : "Save look"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
