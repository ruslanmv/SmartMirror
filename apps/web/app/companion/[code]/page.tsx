"use client";

import { downscaleImage } from "@smartmirror/device-capabilities";
import { Badge, Button, Icon, Wordmark } from "@smartmirror/ui";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";

import { Mirror } from "@/components/Mirror";
import { sendCompanionPhoto } from "@/lib/companion";

import "../../smartmirror/mirror.css";
import "../companion.css";

/** Phone-side capture page opened from the mirror's QR code. */
export default function CompanionCapture() {
  const { code } = useParams<{ code: string }>();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      setPhoto(await downscaleImage(reader.result));
      setSent(false);
    };
    reader.readAsDataURL(file);
  };

  const send = () => {
    if (!photo) return;
    setBusy(true);
    const ok = sendCompanionPhoto(code, photo);
    setBusy(false);
    setSent(ok);
  };

  return (
    <main className="companion-page">
      <Wordmark />
      <section className="sm-panel companion-card">
        <Badge tone="accent">Screen {code}</Badge>
        <h1 className="sm-display" style={{ fontSize: "2rem" }}>
          {sent ? "Sent to your mirror" : photo ? "Looking good?" : "Take a full-length photo"}
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
            <Button variant="primary" size="lg" icon="arrow-right" busy={busy} onClick={send}>
              Send to mirror
            </Button>
            <Button icon="refresh" onClick={() => input.current?.click()}>
              Retake
            </Button>
          </>
        ) : (
          <>
            <p className="sm-muted">Prop your phone at hip height, a few steps away, and step back until you fit the arch.</p>
            <Button variant="primary" size="lg" icon="camera" onClick={() => input.current?.click()}>
              Open camera
            </Button>
          </>
        )}
        <p className="companion-note">
          The photo goes straight to your mirror screen. In this preview build, delivery works when the phone view and the mirror share a
          browser (for example the simulator); cross-device delivery uses the OllaBridge relay.
        </p>
      </section>
    </main>
  );
}
