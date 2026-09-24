"use client";

import { Button, Chip, Icon, garmentColor } from "@smartmirror/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { WARDROBE_FILTERS, WardrobeGrid, filterItems } from "@/components/WardrobeGrid";
import { ApiError, api } from "@/lib/api";
import type { WardrobeItem } from "@/lib/tools";

export default function WardrobePage() {
  const [items, setItems] = useState<WardrobeItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .wardrobe()
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof ApiError ? e : new ApiError("Could not load wardrobe", 500, "error")));
  }, []);

  useEffect(load, [load]);

  const visible = items ? filterItems(items, filter) : [];

  return (
    <div className="screen">
      <ScreenHeader
        title="My wardrobe"
        subtitle={items ? `${items.length} pieces · stored on your HomePilot` : "Loading your pieces…"}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add piece
          </Button>
        }
      />
      <div className="wardrobe">
        <div className="chip-group" role="tablist" aria-label="Filter wardrobe">
          {WARDROBE_FILTERS.map((f) => (
            <Chip
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              data-autofocus={f.id === "all" || undefined}
            >
              {f.label}
              {items && f.match && <span className="sm-faint">{filterItems(items, f.id).length}</span>}
            </Chip>
          ))}
        </div>
        <div className="scroll-area">
          {error ? (
            <div className="empty">
              <div className="empty__icon">
                <Icon name="refresh" />
              </div>
              <p className="empty__title">Wardrobe unavailable</p>
              <p>{error.message}</p>
              <Button icon="refresh" onClick={load}>
                Try again
              </Button>
            </div>
          ) : !items ? (
            <div className="wardrobe-grid">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="skeleton" style={{ aspectRatio: "0.8" }} />
              ))}
            </div>
          ) : visible.length ? (
            <WardrobeGrid items={visible} />
          ) : (
            <div className="empty">
              <div className="empty__icon">
                <Icon name="hanger" />
              </div>
              <p className="empty__title">Nothing here yet</p>
              <p>Add pieces from here or from HomePilot, and they’ll show up on every screen.</p>
            </div>
          )}
        </div>
      </div>
      {adding && (
        <AddPiece
          onClose={() => setAdding(false)}
          onAdded={(item) => {
            setItems((list) => (list ? [...list, item] : [item]));
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

const CATEGORIES = ["top", "blouse", "knit", "dress", "skirt", "pants", "jeans", "blazer", "jacket", "coat", "heels", "boots", "sneakers", "bag"];
const COLORS = ["black", "white", "ivory", "beige", "camel", "brown", "burgundy", "red", "pink", "emerald", "navy", "denim", "grey", "gold"];
const MATERIALS = ["cotton", "silk", "wool", "linen", "leather", "denim", "cashmere", "satin"];

function AddPiece({ onClose, onAdded }: { onClose: () => void; onAdded: (item: WardrobeItem) => void }) {
  const toast = useToast();
  const [category, setCategory] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [material, setMaterial] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!category) {
      setError("Choose what kind of piece this is.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await api.addItem({
        category,
        color: color ?? undefined,
        material: material ?? undefined,
        metadata: name.trim() ? { name: name.trim() } : undefined,
      });
      toast("Added to your wardrobe");
      onAdded(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the piece");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" data-dpad-scope role="dialog" aria-modal="true" aria-labelledby="add-title">
      <form className="sm-panel add-form" onSubmit={submit}>
        <h2 id="add-title" className="add-form__title">
          Add a piece
        </h2>
        <div className="chip-group" role="group" aria-label="Category">
          <span className="chip-group__label">What is it?</span>
          {CATEGORIES.map((c, i) => (
            <Chip key={c} pressed={category === c} onClick={() => setCategory(c)} data-autofocus={i === 0 || undefined}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="chip-group" role="group" aria-label="Colour">
          <span className="chip-group__label">Colour</span>
          {COLORS.map((c) => (
            <Chip key={c} pressed={color === c} onClick={() => setColor(color === c ? null : c)}>
              <span className="color-dot" style={{ background: garmentColor(c) }} />
              {c}
            </Chip>
          ))}
        </div>
        <div className="chip-group" role="group" aria-label="Material">
          <span className="chip-group__label">Material</span>
          {MATERIALS.map((m) => (
            <Chip key={m} pressed={material === m} onClick={() => setMaterial(material === m ? null : m)}>
              {m}
            </Chip>
          ))}
        </div>
        <label className="sm-field">
          <span className="sm-field__label">Name (optional)</span>
          <input className="sm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grandma’s silk scarf" maxLength={80} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} data-dpad-back>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="check" busy={busy}>
            Add to wardrobe
          </Button>
        </div>
      </form>
    </div>
  );
}
