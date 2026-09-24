import { DEVICE_PROFILES } from "@smartmirror/device-capabilities";
import { Icon, Wordmark, buttonClass, type IconName } from "@smartmirror/ui";
import Link from "next/link";

import { BackendStatus } from "@/components/BackendStatus";

import "./site.css";

const SURFACES: Array<{ icon: IconName; title: string; href: string; cta: string; body: string; tag: string }> = [
  {
    icon: "monitor",
    title: "Browser",
    href: "/smartmirror",
    cta: "Open Smart Mirror",
    tag: "Responsive",
    body: "The full product UI on a laptop, tablet or phone. Touch, keyboard, browser camera and Web Speech.",
  },
  {
    icon: "remote",
    title: "Echo Show 21",
    href: "/simulator/echo-show-21",
    cta: "Open simulator",
    tag: "1920 × 1080",
    body: "A thin Android shell loads this same UI and bridges D-pad, CameraX and pairing. Simulate it here first.",
  },
  {
    icon: "alexa",
    title: "Alexa skill",
    href: "/alexa",
    cta: "Open Alexa entry",
    tag: "HTML interface",
    body: "“Alexa, open Smart Mirror” launches this page through Alexa.Presentation.HTML on devices that support it; others fall back to APL.",
  },
];

export default function Hub() {
  return (
    <div className="site">
      <header className="site-header">
        <Wordmark />
        <nav className="site-nav" aria-label="Primary">
          <Link href="/simulator/echo-show-21">Simulator</Link>
          <Link href="/smartmirror/pairing">Pairing</Link>
          <a href="https://github.com/ruslanmv/SmartMirror" target="_blank" rel="noreferrer">
            GitHub <Icon name="external" />
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero__copy">
            <p className="sm-eyebrow">One UI · every screen</p>
            <h1 className="hero__title">
              Your wardrobe, <em>styled</em> on any screen.
            </h1>
            <p className="hero__lede">
              Smart Mirror is an AI stylist and virtual try-on built web-first. The same Next.js interface runs in the browser, inside the Echo Show
              app, and from an Alexa skill, while your photos and wardrobe stay on your HomePilot at home.
            </p>
            <div className="hero__ctas">
              <Link href="/simulator/echo-show-21" className={buttonClass({ variant: "primary", size: "lg" })}>
                <Icon name="remote" /> Echo Show 21 simulator
              </Link>
              <Link href="/smartmirror" className={buttonClass({ size: "lg" })}>
                Open Smart Mirror <Icon name="arrow-right" />
              </Link>
            </div>
            <BackendStatus />
          </div>
          <div className="hero__visual" aria-hidden="true">
            <div className="hero__echo">
              <div className="hero__echo-screen">
                <div className="hero__echo-arch" />
                <div className="hero__echo-lines">
                  <span />
                  <span />
                  <div className="hero__echo-tiles">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Three ways to run the same product</h2>
          <div className="surfaces">
            {SURFACES.map((s) => (
              <Link key={s.title} href={s.href} className="surface">
                <span className="surface__icon">
                  <Icon name={s.icon} />
                </span>
                <span className="surface__tag">{s.tag}</span>
                <span className="surface__title">{s.title}</span>
                <span className="surface__body">{s.body}</span>
                <span className="surface__cta">
                  {s.cta} <Icon name="arrow-right" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Simulator profiles</h2>
          <p className="section__lede">
            Toggle touch, camera, microphone, Alexa, D-pad and connectivity to prove the UI never depends on hardware the Echo might not expose.
          </p>
          <div className="profiles">
            {Object.values(DEVICE_PROFILES).map((p) => (
              <Link key={p.id} href={`/simulator/${p.id}`} className="profile">
                <span className="profile__name">{p.name}</span>
                <span className="profile__desc">{p.description}</span>
                <span className="profile__caps">
                  {Object.entries(p.capabilities)
                    .filter(([k]) => ["touch", "camera", "microphone", "dpad"].includes(k))
                    .map(([k, v]) => (
                      <span key={k} data-on={v}>
                        {k === "dpad" ? "D-pad" : k}
                      </span>
                    ))}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Where your data lives</h2>
          <div className="arch">
            <div className="arch__zone arch__zone--cloud">
              <span className="arch__label">Cloud</span>
              <div className="arch__node">
                <b>Vercel</b>
                <span>UI · simulator · pairing · thin BFF</span>
              </div>
              <div className="arch__arrow">HTTPS · HttpOnly session</div>
              <div className="arch__node">
                <b>OllaBridge Cloud</b>
                <span>auth · pairing · HomePilot relay</span>
              </div>
            </div>
            <div className="arch__boundary">
              <span>WSS · outbound from home</span>
            </div>
            <div className="arch__zone arch__zone--home">
              <span className="arch__label">Your home</span>
              <div className="arch__node">
                <b>HomePilot</b>
                <span>MCP orchestration · ComfyUI · compute</span>
              </div>
              <div className="arch__arrow">MCP</div>
              <div className="arch__node arch__node--accent">
                <b>SmartMirror backend</b>
                <span>wardrobe DB · body captures · try-on jobs · MinIO · Postgres</span>
              </div>
            </div>
          </div>
          <p className="section__lede">
            The browser never receives an OllaBridge credential. Screens pair with a short code and get an encrypted, HttpOnly session; the BFF
            only calls allow-listed SmartMirror tools.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <span>Smart Mirror · Apache-2.0</span>
        <span>Built with Next.js · deployed on Vercel</span>
      </footer>
    </div>
  );
}
