"use client";

import { Button, Chip, Icon, StatusPill } from "@smartmirror/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { QRCode } from "@/components/QRCode";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import { useDevice } from "@/lib/capabilities";

type SessionInfo = Awaited<ReturnType<typeof api.session>>;
type Method = "show" | "type";

const BACKEND_LABEL: Record<SessionInfo["backend"], string> = {
  demo: "Demo data (no backend configured)",
  direct: "SmartMirror API (direct)",
  ollabridge: "OllaBridge → HomePilot",
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function deviceNameFor(runtime: string): string {
  return runtime === "echo-shell" ? "Echo Show" : runtime === "alexa-html" ? "Alexa screen" : "Browser";
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PairingPage() {
  const router = useRouter();
  const toast = useToast();
  const { runtime, refreshHealth, health } = useDevice();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [method, setMethod] = useState<Method | null>(null);

  const load = useCallback(() => {
    api
      .session()
      .then((s) => {
        setInfo(s);
        setMethod((m) => m ?? (s.pairing.device && s.pairing.primary === "device" ? "show" : "type"));
      })
      .catch(() => setInfo(null));
  }, []);
  useEffect(load, [load]);

  const onPaired = useCallback(() => {
    toast("Screen paired");
    load();
    refreshHealth();
    router.push("/smartmirror");
  }, [toast, load, refreshHealth, router]);

  const canShow = Boolean(info?.pairing.device);
  const canType = Boolean(info?.pairing.code);

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
              <Icon name="phone" />
              <span>
                Scan the code with your phone, sign in to OllaBridge and tap <b>Confirm</b>. That&rsquo;s it: no typing on the
                mirror.
              </span>
            </p>
            <p className="pairing__fact">
              <Icon name="shield" />
              <span>
                The screen gets a private session cookie. Its OllaBridge key stays on the server and is never stored in this
                app&rsquo;s pages.
              </span>
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
              {info.pairing.gateway && (
                <div className="kv">
                  <dt>OllaBridge</dt>
                  <dd>{info.pairing.gateway}</dd>
                </div>
              )}
              <div className="kv">
                <dt>This screen</dt>
                <dd>
                  <StatusPill tone={info.paired ? "ok" : info.pairingRequired ? "warn" : "idle"}>
                    {info.paired ? `Paired · ${info.session?.deviceName ?? info.session?.kind}` : info.pairingRequired ? "Not paired" : "Pairing optional"}
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

        <section className="sm-panel pairing__card" aria-label="Pair this screen">
          {!info ? (
            <span className="waiting">
              <span className="sm-spinner" /> Checking this screen…
            </span>
          ) : info.paired ? (
            <PairedCard info={info} onChanged={() => (load(), refreshHealth())} />
          ) : (
            <>
              {canShow && canType && (
                <div className="chip-group pairing__methods" role="tablist" aria-label="How to pair">
                  <Chip role="tab" aria-selected={method === "show"} icon="phone" onClick={() => setMethod("show")}>
                    Show a code
                  </Chip>
                  <Chip
                    role="tab"
                    aria-selected={method === "type"}
                    icon="link"
                    onClick={() => {
                      if (method === "show") api.pairCancel().catch(() => undefined);
                      setMethod("type");
                    }}
                  >
                    Type a code
                  </Chip>
                </div>
              )}
              {method === "show" && canShow ? (
                <ShowCode runtime={runtime} demo={info.backend === "demo"} onPaired={onPaired} />
              ) : canType ? (
                <TypeCode runtime={runtime} kind={info.pairing.code!} onPaired={onPaired} />
              ) : (
                <p className="form-error">Pairing is not configured on this deployment.</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Show a code: TV-style device flow                                   */
/* ------------------------------------------------------------------ */

type ShowState =
  | { phase: "starting" }
  | { phase: "waiting"; userCode: string; url: string; expiresAt: number; interval: number }
  | { phase: "expired" }
  | { phase: "error"; message: string };

function ShowCode({ runtime, demo, onPaired }: { runtime: string; demo: boolean; onPaired: () => void }) {
  const [state, setState] = useState<ShowState>({ phase: "starting" });
  const [generation, setGeneration] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [warning, setWarning] = useState<string | null>(null);
  const started = useRef(-1);

  // One OllaBridge pairing per generation (guards React's double-invoked effects).
  useEffect(() => {
    if (started.current === generation) return;
    started.current = generation;
    setState({ phase: "starting" });
    setWarning(null);
    api
      .pairStart(deviceNameFor(runtime), runtime)
      .then((r) =>
        setState({
          phase: "waiting",
          userCode: r.userCode,
          url: r.verificationUrl,
          expiresAt: Date.now() + r.expiresIn * 1000,
          interval: Math.max(2, r.interval),
        }),
      )
      .catch((err) => setState({ phase: "error", message: err instanceof ApiError ? err.message : "Could not start pairing" }));
  }, [generation, runtime]);

  // Poll until approved or expired.
  const waiting = state.phase === "waiting" ? state : null;
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!alive) return;
      if (Date.now() > waiting.expiresAt) {
        setState({ phase: "expired" });
        return;
      }
      try {
        const r = await api.pairPoll();
        if (!alive) return;
        setWarning(r.warning ?? null);
        if (r.status === "approved") return onPaired();
        if (r.status === "expired") return setState({ phase: "expired" });
      } catch {
        if (alive) setWarning("Connection hiccup. Still waiting…");
      }
      if (alive) timer = setTimeout(tick, waiting.interval * 1000);
    };
    timer = setTimeout(tick, waiting.interval * 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [waiting, onPaired]);

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const newCode = (
    <Button icon="refresh" onClick={() => setGeneration((g) => g + 1)} data-autofocus>
      Get a new code
    </Button>
  );

  if (state.phase === "starting") {
    return (
      <span className="waiting">
        <span className="sm-spinner" /> Getting a code from OllaBridge…
      </span>
    );
  }
  if (state.phase === "error") {
    return (
      <>
        <p className="form-error">{state.message}</p>
        {newCode}
      </>
    );
  }
  if (state.phase === "expired") {
    return (
      <>
        <p className="sm-eyebrow">Code expired</p>
        <p className="sm-muted pairing__hint">Codes last ten minutes. Get a fresh one and scan it again.</p>
        {newCode}
      </>
    );
  }

  const link = `${state.url}${state.url.includes("?") ? "&" : "?"}code=${encodeURIComponent(state.userCode)}`;
  const shortUrl = state.url.replace(/^https?:\/\//, "");
  return (
    <div className="pair-show">
      <p className="sm-eyebrow">Scan with your phone</p>
      <QRCode value={link} label={`QR code to confirm pairing code ${state.userCode}`} />
      <p className="pair-show__code" aria-live="polite" aria-label={`Pairing code ${state.userCode.split("").join(" ")}`}>
        {state.userCode}
      </p>
      <p className="sm-muted pairing__hint">
        Or open <b>{shortUrl}</b> and enter the code.
      </p>
      <div className="pair-show__foot">
        <span className="waiting">
          <span className="sm-spinner" /> Waiting for you to confirm · {mmss((state.expiresAt - now) / 1000)}
        </span>
        <Button variant="ghost" size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
          New code
        </Button>
      </div>
      {warning && <p className="sm-faint pairing__hint">{warning}</p>}
      {demo && <p className="sm-faint pairing__hint">Demo mode: this code confirms itself in a few seconds.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Type a code: fallback keypad (3D Avatar style)                      */
/* ------------------------------------------------------------------ */

function TypeCode({
  runtime,
  kind,
  onPaired,
}: {
  runtime: string;
  kind: "ollabridge" | "access" | "demo";
  onPaired: () => void;
}) {
  // OllaBridge codes are ABCD-1234: letters first, then digits.
  const structured = kind !== "access";
  const length = structured ? 8 : 12;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keypadRef = useRef<HTMLDivElement>(null);
  const wantsLetters = structured && code.length < 4;

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        await api.pair(value, deviceNameFor(runtime), runtime);
        setCode("");
        onPaired();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Pairing failed");
        setCode("");
      } finally {
        setBusy(false);
      }
    },
    [runtime, onPaired],
  );

  const press = useCallback(
    (ch: string) => {
      if (busy) return;
      const isLetter = /^[A-Z]$/.test(ch);
      if (structured && isLetter !== code.length < 4) return;
      setError(null);
      const next = (code + ch).slice(0, length);
      setCode(next);
      if (structured && next.length === length) void submit(next);
    },
    [busy, code, length, structured, submit],
  );

  // When the keypad swaps letters for digits the focused key disappears; give
  // D-pad focus back to the first key instead of losing it.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      keypadRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    }
  }, [wantsLetters]);

  // Physical keyboards and remotes with number keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (/^[A-Z0-9]$/.test(key)) press(key);
      else if (e.key === "Backspace" && code) {
        e.preventDefault();
        e.stopPropagation();
        setCode((c) => c.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [press, code]);

  const slots = structured ? 8 : Math.max(6, code.length + 1);
  const shown = Math.min(slots, length);
  return (
    <>
      <p className="sm-eyebrow">{kind === "ollabridge" ? "Code from your OllaBridge dashboard" : "Pairing code"}</p>
      <div className="code-slots" aria-live="polite" aria-label={`${code.length} of ${shown} characters entered`}>
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className="code-slot" data-active={i === code.length} data-gap={structured && i === 4}>
            {code[i] ?? ""}
          </span>
        ))}
      </div>
      <div ref={keypadRef} className={wantsLetters ? "keypad keypad--letters" : "keypad"}>
        {(wantsLetters ? LETTERS : DIGITS).map((k, i) => (
          <Button key={k} onClick={() => press(k)} data-autofocus={i === 0 || undefined} disabled={busy}>
            {k}
          </Button>
        ))}
        <Button aria-label="Delete" icon="back" onClick={() => setCode((c) => c.slice(0, -1))} disabled={busy || !code} />
        {!wantsLetters && (
          <Button onClick={() => press("0")} disabled={busy}>
            0
          </Button>
        )}
        <Button aria-label="Clear" icon="close" onClick={() => setCode("")} disabled={busy || !code} />
      </div>
      {!structured && (
        <Button icon="link" onClick={() => void submit(code)} disabled={busy || code.length < 4}>
          Pair
        </Button>
      )}
      {busy && (
        <span className="waiting">
          <span className="sm-spinner" /> Pairing…
        </span>
      )}
      {error && <p className="form-error">{error}</p>}
      {kind === "ollabridge" && (
        <p className="sm-faint pairing__hint">In OllaBridge, open Devices → Link device to get a code.</p>
      )}
      {kind === "demo" && <p className="sm-faint pairing__hint">Demo mode: any ABCD-1234 code pairs.</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Paired                                                             */
/* ------------------------------------------------------------------ */

function PairedCard({ info, onChanged }: { info: SessionInfo; onChanged: () => void }) {
  const toast = useToast();
  const s = info.session;
  return (
    <>
      <p className="sm-eyebrow">This screen is paired</p>
      <dl className="pairing__status">
        <div className="kv">
          <dt>Name</dt>
          <dd>{s?.deviceName ?? "SmartMirror screen"}</dd>
        </div>
        {s?.deviceId && (
          <div className="kv">
            <dt>OllaBridge device</dt>
            <dd>{s.deviceId}</dd>
          </div>
        )}
        {s?.expiresAt && (
          <div className="kv">
            <dt>Session renews by</dt>
            <dd>{new Date(s.expiresAt * 1000).toLocaleDateString()}</dd>
          </div>
        )}
      </dl>
      <Button
        variant="danger"
        icon="close"
        data-autofocus
        onClick={async () => {
          await api.unpair();
          toast("This screen forgot its pairing");
          onChanged();
        }}
      >
        Forget this screen
      </Button>
      {s?.kind === "device" && (
        <p className="sm-faint pairing__hint">
          To revoke access everywhere, remove <b>SmartMirror</b> from Devices in your OllaBridge dashboard.
        </p>
      )}
    </>
  );
}
