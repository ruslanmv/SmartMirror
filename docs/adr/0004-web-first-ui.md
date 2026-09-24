# ADR 0004: One web-first UI, thin device shells

Status: Accepted

## Context

SmartMirror has to run on a laptop browser, on Echo Show 21 (whose camera,
microphone and touch exposure to third-party apps is still unverified) and,
where supported, from an Alexa skill. Building a Compose UI, a web UI and an
APL UI separately would triple the work and let them drift.

## Decision

- The product UI is a Next.js app in `apps/web`, deployed to Vercel on every push.
- The Echo Show app (`apps/echo-show`) is a WebView shell that hosts that UI and
  bridges only native-only capabilities (`window.SmartMirrorNative`).
- The Alexa skill launches the same UI with `Alexa.Presentation.HTML.Start` when
  the device supports it and falls back to APL otherwise.
- Hardware is a capability check (`packages/device-capabilities`), never an
  assumption. The Vercel simulator (`/simulator/*`) toggles every capability so
  regressions show up without the physical device.
- Vercel hosts UI and a thin BFF only. Wardrobe data, body captures, the
  database, MinIO and AI jobs stay on the owner's HomePilot machine.
- The browser never holds an OllaBridge credential. Screens pair with a short
  code and receive an encrypted HttpOnly session; the BFF calls only the MCP
  tools listed in `packages/contracts/smartmirror-mcp-tools.json`.

## Consequences

- One codebase for all screens; native code shrinks to the bridge.
- The Echo UI needs network access to the deployment; offline use on the Echo
  requires the shell to cache or bundle the UI later.
- Remote companion-phone handoff needs a generic OllaBridge device-message
  relay. Until it exists, handoff works within one browser (simulator/tabs).
