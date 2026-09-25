"use client";

import { Button, Chip, Icon } from "@smartmirror/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { QRCode } from "@/components/QRCode";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import type { DraftItem } from "@/lib/tools";

const CATEGORY_LABEL: Record<string, string> = {
  top: "Top",
  bottom: "Bottom",
  dress: "Dress",
  outerwear: "Outerwear",
  shoes: "Shoes",
  bag: "Bag",
  accessory: "Accessory",
};
const COMMON_COLORS = ["black", "white", "navy", "grey", "beige", "blue", "red", "green", "brown", "pink"];

/**
 * Add clothes (W-2): photos from the phone (closet scan) or this device go to
 * the owner's PC, which suggests category and colour. Each piece waits here
 * until the owner confirms it — usually one press.
 */
export default function AddClothesPage() {
  const toast = useToast();
  const [queue, setQueue] = useState<DraftItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .reviewQueue()
      .then((q) => {
        setQueue(q);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load the review queue"));
  }, []);

  // New pieces arrive from the phone at any time.
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files).slice(0, 10)) {
      setUploading((n) => n + 1);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error("unreadable")));
          r.onerror = () => reject(new Error("unreadable"));
          r.readAsDataURL(f);
        });
        await api.ingestGarment(dataUrl);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "That photo could not be added", { tone: "warn" });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    load();
  };

  return (
    <div className="screen">
      <ScreenHeader
        title="Add clothes"
        subtitle="Photograph each piece. Your PC suggests what it is; you confirm."
        backHref="/smartmirror/wardrobe"
      />
      <div className="add-clothes">
        <section className="sm-panel add-clothes__source" aria-label="Add photos">
          <PhoneScan />
          <div className="add-clothes__or">or</div>
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
          <Button icon="upload" onClick={() => file.current?.click()} busy={uploading > 0}>
            {uploading > 0 ? `Adding ${uploading}…` : "Upload photos from this device"}
          </Button>
          <p className="sm-faint add-clothes__note">
            Photos stay on your HomePilot PC. Location data is removed before anything is stored.
          </p>
        </section>

        <section className="add-clothes__queue scroll-area" aria-live="polite" aria-label="Pieces to confirm">
          {error ? (
            <p className="form-error">{error}</p>
          ) : queue === null ? (
            <div className="skeleton" style={{ height: "12rem" }} />
          ) : queue.length === 0 ? (
            <div className="empty">
              <div className="empty__icon">
                <Icon name="hanger" />
              </div>
              <p className="empty__title">Nothing to confirm</p>
              <p>New pieces appear here a moment after you take their photo.</p>
            </div>
          ) : (
            queue.map((d, i) => (
              <DraftCard
                key={d.id}
                draft={d}
                autoFocus={i === 0}
                onDone={(msg) => {
                  toast(msg);
                  setQueue((q) => (q ? q.filter((x) => x.id !== d.id) : q));
                }}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function PhoneScan() {
  const [link, setLink] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .companionStart("garment")
      .then((r) => {
        if (!alive) return;
        if (r.mode === "remote") setLink(`${window.location.origin}/companion/${r.code}?m=garment&t=${encodeURIComponent(r.ticket)}`);
        else setLocal(true);
      })
      .catch(() => alive && setLocal(true));
    return () => {
      alive = false;
    };
  }, []);

  if (local) {
    return <p className="sm-muted">Phone scanning works once this screen is paired with your HomePilot. Upload photos below.</p>;
  }
  if (!link) {
    return (
      <span className="waiting">
        <span className="sm-spinner" aria-hidden="true" /> Preparing a link for your phone…
      </span>
    );
  }
  return (
    <>
      <p className="sm-eyebrow">Scan your closet with your phone</p>
      <QRCode value={link} label="QR code to add clothes from your phone" />
      <p className="sm-muted add-clothes__note">One photo per piece, flat or hanging, in good light. The link works for 10 minutes.</p>
    </>
  );
}

function DraftCard({ draft, autoFocus, onDone }: { draft: DraftItem; autoFocus: boolean; onDone: (msg: string) => void }) {
  const s = draft.suggested;
  const [category, setCategory] = useState<string | null>(s.category);
  const [subcategory, setSubcategory] = useState<string | null>(s.subcategory);
  const [color, setColor] = useState<string | null>(s.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = [...new Set([...(s.category ? [s.category] : []), ...(draft.alternatives.category ?? []), ...draft.categories])];
  const subs = [...new Set([...(s.subcategory ? [s.subcategory] : []), ...(draft.alternatives.subcategory ?? [])])].slice(0, 4);
  const colors = [...new Set([...(s.color ? [s.color] : []), ...(draft.alternatives.color ?? []), ...COMMON_COLORS])].slice(0, 8);
  const unsure = (field: string) => draft.needs_review.includes(field);

  const confirm = async () => {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmGarment(draft.id, { category, ...(subcategory ? { subcategory } : {}), ...(color ? { color } : {}) });
      onDone("Added to your wardrobe");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not confirm");
      setBusy(false);
    }
  };

  return (
    <article className="sm-panel draft" aria-label="Piece to confirm">
      <div className="draft__photo">
        {draft.image_url ? <img src={draft.image_url} alt="Garment photo" /> : <Icon name="hanger" />}
      </div>
      <div className="draft__body">
        <div className="chip-group" role="group" aria-label="Category">
          <span className="chip-group__label">
            {unsure("category") ? "What is it?" : "Category"}
            {!unsure("category") && s.category && <Badgeish text="suggested" />}
          </span>
          {categories.map((c, i) => (
            <Chip key={c} pressed={category === c} onClick={() => setCategory(c)} data-autofocus={(autoFocus && i === 0) || undefined}>
              {CATEGORY_LABEL[c] ?? c}
            </Chip>
          ))}
        </div>
        {subs.length > 0 && (
          <div className="chip-group" role="group" aria-label="Type">
            <span className="chip-group__label">Type</span>
            {subs.map((c) => (
              <Chip key={c} pressed={subcategory === c} onClick={() => setSubcategory(subcategory === c ? null : c)}>
                {c}
              </Chip>
            ))}
          </div>
        )}
        <div className="chip-group" role="group" aria-label="Colour">
          <span className="chip-group__label">{unsure("color") ? "Colour?" : "Colour"}</span>
          {colors.map((c) => (
            <Chip key={c} pressed={color === c} onClick={() => setColor(color === c ? null : c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="outfit__actions">
          <Button variant="primary" icon="check" onClick={() => void confirm()} disabled={!category} busy={busy}>
            {category ? "Add to wardrobe" : "Pick a category"}
          </Button>
          <Button
            variant="ghost"
            icon="trash"
            onClick={async () => {
              await api.removeGarment(draft.id).catch(() => undefined);
              onDone("Photo discarded");
            }}
          >
            Discard
          </Button>
        </div>
        {error && <p className="form-error" style={{ textAlign: "left" }}>{error}</p>}
      </div>
    </article>
  );
}

function Badgeish({ text }: { text: string }) {
  return <span className="draft__hint">{text}</span>;
}
