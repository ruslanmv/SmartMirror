"use client";

import { MirrorMark } from "@smartmirror/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { startAlexa } from "@/lib/alexa";

/**
 * Entry point for Alexa.Presentation.HTML.Start. Creates the Alexa client
 * (which only succeeds on a device that supports the HTML interface), then
 * hands over to the normal SmartMirror UI in "alexa-html" runtime.
 */
export default function AlexaEntry() {
  const router = useRouter();
  const [status, setStatus] = useState("Connecting to Alexa…");

  useEffect(() => {
    let active = true;
    startAlexa()
      .then(() => active && router.replace("/smartmirror?runtime=alexa-html"))
      .catch(() => {
        if (!active) return;
        setStatus("Not running on an Alexa device — opening Smart Mirror in Alexa preview mode.");
        window.setTimeout(() => router.replace("/smartmirror?runtime=alexa-html"), 1500);
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        alignContent: "center",
        gap: "1.5rem",
        textAlign: "center",
        padding: "2rem",
        background: "radial-gradient(60rem 30rem at 50% 0%, rgba(217,183,124,0.14), transparent 70%), var(--sm-bg)",
      }}
    >
      <MirrorMark style={{ width: 72, height: 72, color: "var(--sm-accent)" }} />
      <p className="sm-display" style={{ fontSize: "2.5rem" }}>
        Smart Mirror
      </p>
      <p className="sm-muted" role="status">
        {status}
      </p>
    </main>
  );
}
