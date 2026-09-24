"use client";

import { StatusPill } from "@smartmirror/ui";
import { useEffect, useState } from "react";

import type { HealthReport } from "@/lib/tools";

const LABEL: Record<HealthReport["backend"], string> = {
  demo: "Demo backend · sample wardrobe",
  direct: "Direct SmartMirror API",
  ollabridge: "OllaBridge → HomePilot",
};

export function BackendStatus() {
  const [health, setHealth] = useState<HealthReport | null | "error">(null);
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<HealthReport>) : Promise.reject()))
      .then(setHealth)
      .catch(() => setHealth("error"));
  }, []);

  if (health === null) return <div className="hero__status"><StatusPill tone="idle">Checking backend…</StatusPill></div>;
  if (health === "error") return <div className="hero__status"><StatusPill tone="off">Backend unreachable</StatusPill></div>;
  const ok = health.homepilot === "ok" || (health.backend === "ollabridge" && health.homepilot === "n/a");
  return (
    <div className="hero__status">
      <StatusPill tone={ok ? "ok" : "warn"}>{LABEL[health.backend]}</StatusPill>
      {health.pairingRequired && <StatusPill tone={health.paired ? "ok" : "idle"}>{health.paired ? "Paired" : "Pairing required"}</StatusPill>}
    </div>
  );
}
