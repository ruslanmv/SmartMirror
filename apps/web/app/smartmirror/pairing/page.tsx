"use client";

import { Button, Icon, StatusPill } from "@smartmirror/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";

const LENGTH = 6;
type SessionInfo = Awaited<ReturnType<typeof api.session>>;

const BACKEND_LABEL: Record<SessionInfo["backend"], string> = {
  demo: "Demo data (no backend configured)",
  direct: "SmartMirror API (direct)",
  ollabridge: "OllaBridge → HomePilot",
};

export default function PairingPage() {
  const router = useRouter();
  const toast = useToast();
  const { runtime, refreshHealth, health } = useDevice();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .session()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  useEffect(load, [load]);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        const deviceName = runtime === "echo-shell" ? "Echo Show" : runtime === "alexa-html" ? "Alexa screen" : "Browser";
        await api.pair(value, deviceName);
        toast("Screen paired");
        setCode("");
        load();
        refreshHealth();
        router.push("/smartmirror");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Pairing failed");
        setCode("");
      } finally {
        setBusy(false);
      }
    },
    [runtime, toast, load, refreshHealth, router],
  );

  const press = (d: string) => {
    if (busy) return;
    setError(null);
    const next = (code + d).slice(0, LENGTH);
    setCode(next);
    if (next.length === LENGTH) void submit(next);
  };

  // Physical keyboards and remotes with number keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace" && code) {
        e.preventDefault();
        e.stopPropagation();
        setCode((c) => c.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="screen">
      <ScreenHeader title="Connection" subtitle="Pair this screen with your HomePilot through OllaBridge." />
      <div className="pairing">
        <section className="pairing__intro">
          <h2 className="pairing__headline">
            Your wardrobe stays at home.
            <br />
            <span className="sm-muted">This screen just looks in.</span>
          </h2>
          <div className="pairing__facts">
            <p className="pairing__fact">
              <Icon name="link" />
              <span>
                Open OllaBridge on your phone, choose <b>Add screen</b>, and enter the 6-digit code here.
              </span>
            </p>
            <p className="pairing__fact">
              <Icon name="shield" />
              <span>The screen gets a private session cookie. No HomePilot password or permanent token is ever stored in this app.</span>
            </p>
            <p className="pairing__fact">
              <Icon name="home" />
              <span>Photos and wardrobe data live on your HomePilot PC; the cloud only relays requests.</span>
            </p>
          </div>
          {info && (
            <dl className="pairing__status">
              <div className="kv">
                <dt>Backend</dt>
                <dd>{BACKEND_LABEL[info.backend]}</dd>
              </div>
              <div className="kv">
                <dt>This screen</dt>
                <dd>
                  <StatusPill tone={info.paired ? "ok" : info.pairingRequired ? "warn" : "idle"}>
                    {info.paired ? `Paired · ${info.session?.kind}` : info.pairingRequired ? "Not paired" : "Pairing optional"}
                  </StatusPill>
                </dd>
              </div>
              {health?.node && (
                <div className="kv">
                  <dt>HomePilot node</dt>
                  <dd>{health.node.name ?? health.node.id}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section className="sm-panel pairing__card" aria-label="Enter pairing code">
          <p className="sm-eyebrow">Pairing code</p>
          <div className="code-slots" aria-live="polite" aria-label={`${code.length} of ${LENGTH} digits entered`}>
            {Array.from({ length: LENGTH }, (_, i) => (
              <span key={i} className="code-slot" data-active={i === code.length}>
                {code[i] ?? ""}
              </span>
            ))}
          </div>
          <div className="keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} onClick={() => press(d)} data-autofocus={d === "5" || undefined} disabled={busy}>
                {d}
              </Button>
            ))}
            <Button aria-label="Delete digit" icon="back" onClick={() => setCode((c) => c.slice(0, -1))} disabled={busy || !code} />
            <Button onClick={() => press("0")} disabled={busy}>
              0
            </Button>
            <Button aria-label="Clear" icon="close" onClick={() => setCode("")} disabled={busy || !code} />
          </div>
          {busy && (
            <span className="waiting">
              <span className="sm-spinner" /> Pairing…
            </span>
          )}
          {error && <p className="form-error">{error}</p>}
          {info?.backend === "demo" && !info.paired && <p className="sm-faint" style={{ fontSize: "0.85rem" }}>Demo mode: any 6 digits will pair.</p>}
          {info?.paired && (
            <Button
              variant="danger"
              icon="close"
              onClick={async () => {
                await api.unpair();
                toast("Screen unpaired");
                load();
                refreshHealth();
              }}
            >
              Unpair this screen
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
