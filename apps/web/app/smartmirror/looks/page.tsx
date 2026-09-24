"use client";

import { Button, Icon } from "@smartmirror/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { SwatchTile } from "@/components/OutfitCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { deleteLook, saveOutfitSession } from "@/lib/storage";
import { timeAgo, useLooks } from "@/lib/use-local";

export default function LooksPage() {
  const looks = useLooks();
  const router = useRouter();

  return (
    <div className="screen">
      <ScreenHeader title="Recent looks" subtitle="Saved on this screen only." />
      <div className="scroll-area">
        {looks.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <Icon name="looks" />
            </div>
            <p className="empty__title">No saved looks yet</p>
            <p>Save an outfit from your stylist or a try-on and it will wait for you here.</p>
            <Link href="/smartmirror/stylist" className="sm-btn sm-btn--primary" data-autofocus>
              Ask stylist
            </Link>
          </div>
        ) : (
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
                    data-autofocus={i === 0 || undefined}
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
        )}
      </div>
    </div>
  );
}
