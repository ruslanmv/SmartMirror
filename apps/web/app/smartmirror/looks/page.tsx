"use client";

import { Button, Icon } from "@smartmirror/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { SwatchTile } from "@/components/OutfitCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import { deleteLook, saveOutfitSession } from "@/lib/storage";
import type { OutfitSetView, WardrobeItem } from "@/lib/tools";
import { timeAgo, useLooks } from "@/lib/use-local";

export default function LooksPage() {
  return (
    <Suspense>
      <Looks />
    </Suspense>
  );
}

function Looks() {
  const looks = useLooks();
  const router = useRouter();
  const highlight = useSearchParams().get("set");
  const [sets, setSets] = useState<OutfitSetView[] | null>(null);
  const [items, setItems] = useState<WardrobeItem[]>([]);

  const load = useCallback(() => {
    Promise.all([api.sets(), api.wardrobe()])
      .then(([s, w]) => {
        setSets(s);
        setItems(w);
      })
      .catch(() => setSets([])); // plans are optional; saved looks still work unpaired
  }, []);
  useEffect(load, [load]);

  const hasPlans = Boolean(sets?.length);

  return (
    <div className="screen">
      <ScreenHeader title="Recent looks" subtitle="Saved looks stay on this screen; outfit plans live on your PC." />
      <div className="scroll-area">
        {hasPlans && (
          <section aria-label="Outfit plans" className="plans">
            <p className="sm-eyebrow">Outfit plans</p>
            {sets!.map((set) => (
              <PlanCard
                key={set.id}
                set={set}
                items={items}
                autoFocus={set.id === highlight}
                onDeleted={() => setSets((s) => (s ? s.filter((x) => x.id !== set.id) : s))}
              />
            ))}
          </section>
        )}

        {looks.length === 0 ? (
          hasPlans ? null : (
            <div className="empty">
              <div className="empty__icon">
                <Icon name="looks" />
              </div>
              <p className="empty__title">No saved looks yet</p>
              <p>Save an outfit from your stylist or a try-on, or ask it to plan your week.</p>
              <Link href="/smartmirror/stylist" className="sm-btn sm-btn--primary" data-autofocus>
                Ask stylist
              </Link>
            </div>
          )
        ) : (
          <>
            {hasPlans && <p className="sm-eyebrow plans__saved">Saved looks</p>}
            <div className="looks-grid">
              {looks.map((look, i) => (
                <article key={look.id} className="look-card">
                  <div className="look-card__art">
                    {look.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local data URL
                      <img src={look.preview} alt="" />
                    ) : (
                      <div className="look-card__collage">
                        {look.items.slice(0, 4).map((item) => (
                          <SwatchTile key={item.id} item={item} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h2 className="look-card__title">{look.title}</h2>
                    <p className="look-card__meta">
                      {look.items.length} pieces · {timeAgo(look.savedAt)}
                    </p>
                  </div>
                  <div className="look-card__actions">
                    <Button
                      size="sm"
                      variant="primary"
                      icon="wand"
                      data-autofocus={(!highlight && i === 0) || undefined}
                      onClick={() => {
                        saveOutfitSession({ prompt: look.prompt ?? look.title, outfits: [look.outfit], items: look.items });
                        router.push(`/smartmirror/tryon?outfit=${encodeURIComponent(look.outfit.id)}`);
                      }}
                    >
                      Try on
                    </Button>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => deleteLook(look.id)} aria-label={`Delete ${look.title}`}>
                      Remove
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One week or trip: a column per day with the day's pieces. */
function PlanCard({
  set,
  items,
  autoFocus,
  onDeleted,
}: {
  set: OutfitSetView;
  items: WardrobeItem[];
  autoFocus: boolean;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <article className="sm-panel plan-card" aria-label={set.title}>
      <header className="plan-card__head">
        <h2 className="look-card__title">{set.title}</h2>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          aria-label={`Delete ${set.title}`}
          data-autofocus={autoFocus || undefined}
          onClick={async () => {
            try {
              await api.deleteSet(set.id);
              onDeleted();
            } catch (e) {
              toast(e instanceof ApiError ? e.message : "Could not delete the plan", { tone: "warn" });
            }
          }}
        >
          Delete
        </Button>
      </header>
      <ol className="plan-card__days">
        {set.looks.map((look, i) => (
          <li key={i} className="plan-day" title={look.explanation}>
            <span className="plan-day__label">{look.label}</span>
            <div className="look-card__collage">
              {look.item_ids.slice(0, 4).map((id) => {
                const item = byId.get(id);
                return item ? <SwatchTile key={id} item={item} /> : <div key={id} className="plan-day__missing" />;
              })}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
