"use client";

import { Button, Icon } from "@smartmirror/ui";
import { useState } from "react";

import { QRCode } from "@/components/QRCode";
import { ApiError, api } from "@/lib/api";
import type { ShopOffer, WardrobeGap } from "@/lib/tools";

/**
 * Complete the look (W-6): pieces the wardrobe could not supply. Opt-in in
 * Settings; the link opens on the phone (QR), never on the mirror, and the
 * mirror never buys anything itself.
 */
export function CompleteTheLook({ gaps }: { gaps: WardrobeGap[] }) {
  if (!gaps.length) return null;
  return (
    <section className="sm-panel complete-look" aria-label="Complete the look">
      <p className="sm-eyebrow">Complete the look</p>
      <p className="sm-muted complete-look__intro">Your wardrobe has nothing for {gaps.length === 1 ? "this piece" : "these pieces"} yet.</p>
      <div className="complete-look__list">
        {gaps.map((g) => (
          <GapRow key={`${g.slot}:${g.category}`} gap={g} />
        ))}
      </div>
    </section>
  );
}

function GapRow({ gap }: { gap: WardrobeGap }) {
  const [offer, setOffer] = useState<ShopOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [bought, setBought] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      // The query is "<colour> <category>" when the request named a colour.
      const color = gap.query.endsWith(gap.category) ? gap.query.slice(0, -gap.category.length).trim() : "";
      const [first] = await api.shopSuggest(gap.category, color || null);
      setOffer(first ?? null);
      if (!first) setError("No suggestion for this piece");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Shopping suggestions are unavailable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="complete-look__row">
      <div className="complete-look__what">
        <Icon name="hanger" width="1.2em" height="1.2em" />
        <span>{gap.query}</span>
      </div>
      {bought ? (
        <span className="sm-muted">
          <Icon name="check" width="1em" height="1em" /> Marked as bought — add it to your wardrobe when it arrives.
        </span>
      ) : offer ? (
        <div className="complete-look__offer">
          <QRCode value={offer.url} label={`QR code: ${offer.title}`} />
          <div>
            <p className="complete-look__title">{offer.title}</p>
            <p className="sm-faint">Scan with your phone to browse. The mirror never buys anything.</p>
            <Button
              size="sm"
              icon="check"
              onClick={async () => {
                await api.markPurchased(offer.id).catch(() => undefined);
                setBought(true);
              }}
            >
              I bought it
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" icon="external" busy={busy} onClick={() => void find()}>
          Where to buy
        </Button>
      )}
      {error && <p className="form-error" style={{ textAlign: "left" }}>{error}</p>}
    </div>
  );
}
