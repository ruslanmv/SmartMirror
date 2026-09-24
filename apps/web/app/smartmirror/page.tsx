"use client";

import { Chip, TileContent, Badge } from "@smartmirror/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { partOfDay, useNow } from "@/components/Clock";
import { Mirror } from "@/components/Mirror";
import { api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";
import { timeAgo, useCapture, useLooks } from "@/lib/use-local";

const IDEAS = [
  { label: "Dinner date", prompt: "An elegant outfit for a dinner date tonight" },
  { label: "Office day", prompt: "Sharp but comfortable for the office" },
  { label: "Weekend brunch", prompt: "Relaxed weekend brunch look" },
  { label: "Cocktail party", prompt: "Something statement for a cocktail party" },
  { label: "Travel day", prompt: "Comfortable layers for a travel day" },
];

export default function HomePage() {
  const router = useRouter();
  const now = useNow(60_000);
  const { greeting, when } = partOfDay(now);
  const capture = useCapture();
  const looks = useLooks();
  const { capabilities, runtime, hasNativeBridge } = useDevice();
  const [pieces, setPieces] = useState<number | null>(null);

  useEffect(() => {
    api
      .wardrobe()
      .then((items) => setPieces(items.length))
      .catch(() => setPieces(null));
  }, [capabilities.ollabridgeOnline, capabilities.homepilotOnline]);

  const directCamera = capabilities.camera && (runtime !== "echo-shell" || hasNativeBridge) && runtime !== "alexa-html";

  return (
    <div className="home">
      <section className="home__mirror" aria-label="Your mirror">
        <div className="portrait-wrap">
          <Mirror
            imageUrl={capture?.dataUrl}
            label={capture ? "Your latest photo" : "Empty mirror"}
            caption={
              capture ? <Badge tone="accent">Latest photo · {timeAgo(capture.takenAt)}</Badge> : <Badge>No photo yet</Badge>
            }
          />
        </div>
      </section>

      <section className="home__content">
        <p className="sm-eyebrow">{greeting}</p>
        <h1 className="home__headline">
          What would you like <br />
          to wear <em>{when}</em>?
        </h1>

        <nav className="home__tiles" aria-label="Main actions">
          <Link href="/smartmirror/stylist" className="sm-tile" data-autofocus>
            <TileContent icon="sparkle" title="Ask stylist" subtitle="Outfits from your real wardrobe" />
          </Link>
          <Link href="/smartmirror/wardrobe" className="sm-tile">
            <TileContent
              icon="hanger"
              title="My wardrobe"
              subtitle={pieces === null ? "Browse and add pieces" : `${pieces} piece${pieces === 1 ? "" : "s"}`}
            />
          </Link>
          <Link href="/smartmirror/capture" className="sm-tile">
            <TileContent
              icon="camera"
              title="Take photo"
              subtitle={directCamera ? "Mirror capture with countdown" : "Use your phone’s camera"}
            />
          </Link>
          <Link href="/smartmirror/looks" className="sm-tile">
            <TileContent
              icon="looks"
              title="Recent looks"
              subtitle={looks.length ? `${looks.length} saved on this screen` : "Your saved outfits"}
            />
          </Link>
        </nav>

        <div className="home__ideas">
          <span className="home__ideas-label">Quick ideas</span>
          {IDEAS.map((idea) => (
            <Chip
              key={idea.label}
              onClick={() => router.push(`/smartmirror/stylist?prompt=${encodeURIComponent(idea.prompt)}&auto=1`)}
            >
              {idea.label}
            </Chip>
          ))}
          <Link href="/smartmirror/pairing" className="sm-chip" style={{ textDecoration: "none" }}>
            Connection
          </Link>
        </div>
      </section>
    </div>
  );
}
