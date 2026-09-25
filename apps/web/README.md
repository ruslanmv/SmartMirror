# SmartMirror web

The SmartMirror product UI, built web-first with Next.js and deployed to
Vercel. The same pages run in a browser, inside the Echo Show shell
(`apps/echo-show`) and from the Alexa skill (`integrations/alexa`).

| Route | What it is |
|---|---|
| `/` | Redirects to `/smartmirror` (old `/simulator/*` links do too) |
| `/smartmirror` | The product UI (home, `stylist`, `wardrobe`, `capture`, `tryon`, `looks`, `pairing`) |
| `/smartmirror/pairing` | Pair this screen with OllaBridge (show a code, or type one) |
| `/smartmirror/camera-test` | Live camera diagnostics for the current device |
| `/smartmirror/portrait` | Fill screen: a real mirror, or a framed painting on the wall |
| `/smartmirror/settings` | Live mirror default, fill-screen mode, painting style/frame/photo |
| `/alexa` | Entry URL for `Alexa.Presentation.HTML.Start` |
| `/companion/[code]` | Phone-side capture page opened from the mirror's QR code |
| `/api/*` | BFF: health, session/pairing, allow-listed MCP tools, media relay |

## Run locally

```bash
pnpm install
pnpm dev                     # http://localhost:3000 → /smartmirror, demo backend
```

Against the local FastAPI service:

```bash
SMARTMIRROR_API_URL=http://localhost:8100 pnpm dev
```

## Mirror and portrait modes

See `docs/ux/mirror-experience.md` for the mental model (ambient → engage →
capture → customise → keep) and the interaction rules behind these screens.

- **Snap from the mirror**: with the live mirror on, tap the arch, press OK, or
  say "Alexa, take my photo" → 3·2·1 with beeps → flash → the photo freezes in
  the arch with one next step: **Style me · Try it on · Make it art**. The camera
  switches off and the photo stays until you choose **Retake** or **Live mirror**
  (for the rest of the session). Back cancels a countdown.
- A red **Camera on** pill shows whenever any screen streams the camera.

- **Live mirror is on by default**: the home arch shows the live camera. Turn it
  off in **Settings** (or with the button under the arch).
- **Fill screen** (`/smartmirror/portrait`) turns a wall-mounted Echo Show into:
  - **Real mirror**: the live camera, mirrored, edge to edge, nothing else;
  - **Framed painting**: the live camera, the latest photo, a saved try-on look,
    or a favourite photo, rendered as **oil, watercolour, charcoal, vintage print
    or photograph**, in a **gilded, walnut, gallery-black or unframed** frame,
    either filling the screen or hung on a lit wall with a brass plaque.
- It can start automatically after 2–30 idle minutes, and shows an optional clock.
  Any key, tap or pointer movement reveals the controls; Back or Exit leaves.
- Painting effects are SVG filters, so they work on live video too; choose
  "Photograph" on slow devices. All settings and photos stay on the device.
- Voice: "Alexa, ask Smart Mirror to show my portrait".

## Cameras

Capture uses one backwards-compatible camera layer
(`packages/device-capabilities/src/camera-stream.ts`), tried in this order:

| Where | 1st | 2nd | Fallbacks |
|---|---|---|---|
| Laptop / phone browser | `getUserMedia` (modern, or legacy `webkitGetUserMedia`) | — | phone QR, upload |
| Echo Show shell | native bridge (`SmartMirrorNative.requestCapture`) | WebView `getUserMedia` (granted by the shell for the app origin only) | phone QR |
| Alexa HTML session | `getUserMedia` if the device allows it | — | phone QR |

HD and front-camera constraints are relaxed step by step if a camera rejects
them; permission errors fall straight through to the phone option. Devices
with no video input are detected without prompting and start on the phone option.

Real-time testing on a Vercel preview (HTTPS is required for cameras):

- **`/smartmirror/camera-test`** — live preview with resolution/fps, camera
  picker, test photo, native-bridge test, and a diagnostics table (runtime,
  HTTPS, camera API, permission, video inputs). Open it on the laptop, on the
  Echo shell, or in the Alexa session to see what that device really exposes.
- **Live mirror** on the home screen streams the camera into the arch.

## Backends

`SMARTMIRROR_BACKEND` (or auto-detection) picks where tool calls go:

| Mode | When | Tool calls go to |
|---|---|---|
| `ollabridge` | `OLLABRIDGE_BASE_URL`, `SMARTMIRROR_BACKEND=ollabridge`, or **any Vercel deployment** with nothing else configured (defaults to `https://app.ollabridge.com`) | OllaBridge → HomePilot → SmartMirror MCP |
| `direct` | `SMARTMIRROR_API_URL` | SmartMirror `/rpc` |
| `demo` | `SMARTMIRROR_BACKEND=demo`, or local development with nothing configured | in-process sample wardrobe |

## Pairing with OllaBridge

Screens pair the same way the 3D Avatar Chatbot does, with two flows on
`/smartmirror/pairing`:

| Flow | How | OllaBridge calls (server-side) |
|---|---|---|
| **Show a code** (default) | The screen shows `ABCD-1234` and a QR code of `verification_url?code=…`; the owner confirms on their phone | `POST /device/start`, then `POST /device/poll` every few seconds |
| **Type a code** | Type a code from the OllaBridge dashboard (letters keypad, then digits) | `POST /pair {code, label, client}` |

- The screen identifies itself as `User-Agent: smartmirror/<version>` and sends
  `client: {name: "SmartMirror", …}`, so the OllaBridge dashboard lists it as **SmartMirror**.
- The secret `device_code` waits in a short-lived sealed HttpOnly cookie
  (`sm_pairing`, path `/api/session/pair`); the device token is sealed into the
  session cookie. Neither ever reaches the page.
- Demo mode exercises both flows without OllaBridge (the shown code confirms itself).

| Variable | Default | Purpose |
|---|---|---|
| `OLLABRIDGE_BASE_URL` | `https://app.ollabridge.com` in `ollabridge` mode | gateway root, no `/v1` |
| `OLLABRIDGE_PAIRING_FLOW` | `device` | `code` makes typing the default tab |
| `OLLABRIDGE_PAIRING_PATH` | `/pair` | code-entry endpoint |
| `SMARTMIRROR_SESSION_SECRET` | required outside demo | ≥ 32 characters; seals both cookies |
| `OLLABRIDGE_STYLIST_MODEL` | discover `persona:stylist--…` | force a HomePilot persona for the stylist |
| `OLLABRIDGE_MCP_OPERATION` | `agentic.invoke` | HomePilot node job for tool calls (`mcp.tools_call` = legacy shape) |
| `OLLABRIDGE_NODE_ID` | discovered | pin the HomePilot node |

## Tool calls from anywhere

`/api/tools/[tool]` runs SmartMirror's MCP tools on the owner's PC:

```
BFF → OllaBridge Cloud  POST /v1/mirror/nodes/{node}/jobs  {operation: "agentic.invoke", params: {tool, arguments}}
    → OllaBridge Local  homepilot.mirror.job.create          (HOMEPILOT_MIRROR_RELAY_ENABLED)
    → HomePilot         agentic.invoke, allow-listed         (HOMEPILOT_MIRROR_MCP_ENABLED, HOMEPILOT_MIRROR_ALLOWED_TOOLS)
    → SmartMirror MCP   hp.smartmirror.*
```

The HomePilot node is the online device advertising `homepilot.mirror`
(OllaBridge Cloud ≥ OB-4), else the one whose manifest offers `agentic.invoke`;
it is remembered in the session. Errors say what to switch on
(`tool_not_allowed`, `capability_unavailable`, `node_offline`).

## Stylist persona

`/api/stylist/chat` asks the owner's HomePilot persona (imported from
`integrations/homepilot/personas/stylist.hpersona`) through OllaBridge's
OpenAI-compatible `/v1/chat/completions`, non-streaming, with
`X-Client-Type: smart-mirror`. The wardrobe tools choose the outfit first; its
owned items go to the persona as an "Owned items" block so it never invents
clothes. Replies are shown on the stylist screen and read aloud (by Alexa inside
an Alexa session). Settings → Stylist picks the persona and toggles reading aloud.

See `.env.example`. All settings are server-only; nothing uses `NEXT_PUBLIC_`.

## Security model

- Screens pair through OllaBridge (show a code or type one, see above) and get an
  AES-GCM-sealed, HttpOnly, SameSite=Lax cookie. The OllaBridge token is either
  a server env var (single owner) or sealed inside that cookie (device pairing);
  JavaScript can read neither.
- `/api/tools/[tool]` only accepts tools from
  `packages/contracts/smartmirror-mcp-tools.json`, checks required arguments,
  and sets `profile_id` on the server.
- Body photos are downscaled on the device, kept in local storage for 24 hours,
  and only relayed (never stored) through `/api/media` to OllaBridge's
  temporary media store in `ollabridge` mode.
- No other site may frame the app.

## Deploy to Vercel

The repository root contains a `vercel.json` that builds this app, so the
Vercel project works with the default Root Directory (the repo root):

- `framework: nextjs` stops Vercel from auto-detecting the Python backend
  (`pyproject.toml`) as a FastAPI app;
- `pnpm --filter @smartmirror/web build` builds only the web app, and
  `apps/web/.next` is the output;
- the root `package.json` lists `next` so Vercel can detect the Next.js version.

Steps:

1. Import the repository in Vercel (keep Root Directory empty; if you set it to
   `apps/web` instead, `apps/web/vercel.json` is used and also works).
2. Set `SMARTMIRROR_SESSION_SECRET` (32+ random characters, e.g.
   `openssl rand -base64 48`) for Production and Preview. Without it the
   pairing screen says so and no screen can pair. Nothing else is required:
   Vercel deployments pair with OllaBridge Cloud (`https://app.ollabridge.com`)
   by default; set `OLLABRIDGE_BASE_URL` for another gateway, or
   `SMARTMIRROR_BACKEND=demo` for the sample wardrobe.
3. Every push gets a preview URL such as `smartmirror-git-<branch>.vercel.app`;
   it opens straight into the app. Pair it at `/smartmirror/pairing`.

Builds are skipped for commits that do not touch the web app, its packages or
the lockfile.
