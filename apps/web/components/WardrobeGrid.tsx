"use client";

import { GarmentSwatch } from "@smartmirror/ui";

import type { WardrobeItem } from "@/lib/tools";

import { itemName } from "./OutfitCard";

export const WARDROBE_FILTERS: Array<{ id: string; label: string; match: RegExp | null }> = [
  { id: "all", label: "All", match: null },
  { id: "tops", label: "Tops", match: /top|shirt|blouse|tee|knit|sweater|cami|bodysuit/ },
  { id: "bottoms", label: "Bottoms", match: /bottom|skirt|pant|jean|trouser|short/ },
  { id: "dresses", label: "Dresses", match: /dress|jumpsuit|gown/ },
  { id: "outerwear", label: "Outerwear", match: /outerwear|jacket|blazer|coat|cardigan/ },
  { id: "shoes", label: "Shoes", match: /shoe|heel|boot|sneaker|loafer|sandal/ },
  { id: "bags", label: "Bags", match: /bag|clutch|tote|purse/ },
];

export function filterItems(items: WardrobeItem[], filterId: string): WardrobeItem[] {
  const f = WARDROBE_FILTERS.find((x) => x.id === filterId);
  if (!f?.match) return items;
  return items.filter((i) => f.match!.test(i.category.toLowerCase()));
}

export function WardrobeGrid({ items }: { items: WardrobeItem[] }) {
  return (
    <ul className="wardrobe-grid" role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((item) => (
        <li key={item.id}>
          {/* Focusable so remote users can browse; details open in a later milestone. */}
          <div className="garment-card" tabIndex={0} aria-label={`${itemName(item)}, ${item.color ?? ""} ${item.material ?? ""}`}>
            <div className="garment-card__art">
              <GarmentSwatch
                category={item.category}
                color={item.color}
                imageUrl={typeof item.metadata?.image_url === "string" ? item.metadata.image_url : null}
              />
            </div>
            <div>
              <div className="garment-card__name">{itemName(item)}</div>
              <div className="garment-card__meta">{[item.color, item.material].filter(Boolean).join(" · ") || item.category}</div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
