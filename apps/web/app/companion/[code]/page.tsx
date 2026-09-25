"use client";

import { downscaleImage } from "@smartmirror/device-capabilities";
import { Badge, Button, Icon, Wordmark } from "@smartmirror/ui";
import { useParams, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import { Mirror } from "@/components/Mirror";
import { ApiError, api } from "@/lib/api";
import { sendCompanionPhoto } from "@/lib/companion";

import "../../smartmirror/mirror.css";
import "../companion.css";

/** Phone-side capture page opened from the mirror's QR code. */
export default function CompanionCapture() {
  const { code } = useParams<{ code: string }>();
  // Present when the mirror uses a real backend: the photo goes to the owner's PC.
  const search = useSearchParams();
  const ticket = search.get("t");
  // Closet scan: several clothes photos in a row (the ticket decides; this only changes the wording).
  const garments = search.get("m") === "garment";
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      setPhoto(await downscaleImage(reader.result, 1280, 0.85));
      setSent(false);
    };
    reader.readAsDataURL(file);
  };

  const send = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      if (ticket) {
        await api.companionUpload(ticket, photo);
        if (garments) {
          setCount((n) => n + 1);
          setPhoto(null); // ready for the next piece
        } else {
          setSent(true);
        }
      } else {
        setSent(sendCompanionPhoto(code, photo));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the photo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="companion-page">
      <Wordmark />
      <section className="sm-panel companion-card">
        <Badge tone="accent">Screen {code}</Badge>
        <h1 className="sm-display" style={{ fontSize: "2rem" }}>
          {garments
            ? photo
              ? "Send this piece?"
              : count
                ? `${count} sent · next piece`
                : "Photograph one piece of clothing"
            : sent
              ? "Sent to your mirror"
              : photo
                ? "Looking good?"
                : "Take a full-length photo"}
        </h1>
        <Mirror imageUrl={photo} label={photo ? "Your photo" : "Photo guide"} />
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {sent ? (
          <p className="sm-muted">
            <Icon name="check" width="1.1em" height="1.1em" style={{ display: "inline", verticalAlign: "-0.2em", color: "var(--sm-success)" }} /> Check the mirror to
            review it. You can close this page.
          </p>
        ) : photo ? (
          <>
            <Button variant="primary" size="lg" icon="arrow-right" busy={busy} onClick={() => void send()}>
              Send to mirror
            </Button>
            {error && <p className="form-error">{error}</p>}
            <Button icon="refresh" onClick={() => input.current?.click()}>
              Retake
            </Button>
          </>
        ) : (
          <>
            <p className="sm-muted">
              {garments
                ? "Lay the piece flat or hang it against a plain wall, in good light. Your PC suggests the category and colour; you confirm on the mirror."
                : "Prop your phone at hip height, a few steps away, and step back until you fit the arch."}
            </p>
            <Button variant="primary" size="lg" icon="camera" onClick={() => input.current?.click()}>
              Open camera
            </Button>
          </>
        )}
        <p className="companion-note">
          {ticket
            ? "The photo goes to your own HomePilot PC through OllaBridge and appears on the mirror. Location data is removed, and body photos are deleted after 24 hours."
            : "The photo goes straight to your mirror screen when this phone view and the mirror share a browser (for example the simulator)."}
        </p>
      </section>
    </main>
  );
}
