# SmartMirror web

The SmartMirror product UI, built web-first with Next.js and deployed to
Vercel. The same pages run in a browser, inside the Echo Show shell
(`apps/echo-show`) and from the Alexa skill (`integrations/alexa`).

| Route | What it is |
|---|---|
| `/` | Hub: run modes, simulator profiles, data boundary |
| `/smartmirror` | The product UI (home, `stylist`, `wardrobe`, `capture`, `tryon`, `looks`, `pairing`) |
| `/simulator/echo-show-21` | 1920×1080 Echo Show 21 simulation: D-pad only, no camera/mic |
| `/simulator/echo-show-21-experimental` | Same screen with touch, native camera and microphone |
| `/simulator/browser` | Responsive desktop/laptop/tablet/phone frames |
| `/alexa` | Entry URL for `Alexa.Presentation.HTML.Start` |
| `/companion/[code]` | Phone-side capture page opened from the mirror's QR code |
| `/api/*` | BFF: health, session/pairing, allow-listed MCP tools, media relay |

## Run locally

```bash
pnpm install
pnpm dev                     # http://localhost:3000 with the demo backend
```

Against the local FastAPI service:

```bash
SMARTMIRROR_API_URL=http://localhost:8100 pnpm dev
```

## Simulator

Each profile renders the app in an iframe at the device's real resolution and
scales the device frame to fit, so media queries behave as on hardware. The
developer panel:

- toggles **touch, camera, microphone, Alexa, D-pad, OllaBridge online,
  HomePilot online** live (touch off really blocks pointer input in the device);
- has a **remote** (arrows / OK / Back / Home; the keyboard works too);
- sends **Alexa utterances** as the directives the real skill sends;
- shows a **companion phone** next to the device when a phone capture starts;
- logs the **bridge traffic** between simulator and device.

Echo profiles emulate the shell's `window.SmartMirrorNative` bridge, so the
native-camera path runs the same JavaScript as on the Echo.

## Backends

`SMARTMIRROR_BACKEND` (or auto-detection) picks where tool calls go:

| Mode | When | Tool calls go to |
|---|---|---|
| `demo` | nothing configured (every preview) | in-process sample wardrobe |
| `direct` | `SMARTMIRROR_API_URL` | SmartMirror `/rpc` |
| `ollabridge` | `OLLABRIDGE_BASE_URL` + token or pairing path | OllaBridge → HomePilot → SmartMirror MCP |

See `.env.example`. All settings are server-only; nothing uses `NEXT_PUBLIC_`.

## Security model

- Screens pair with a short code (`/smartmirror/pairing`) and get an
  AES-GCM-sealed, HttpOnly, SameSite=Lax cookie. The OllaBridge token is either
  a server env var (single owner) or sealed inside that cookie (device pairing);
  JavaScript can read neither.
- `/api/tools/[tool]` only accepts tools from
  `packages/contracts/smartmirror-mcp-tools.json`, checks required arguments,
  and sets `profile_id` on the server.
- Body photos are downscaled on the device, kept in local storage for 24 hours,
  and only relayed (never stored) through `/api/media` to OllaBridge's
  temporary media store in `ollabridge` mode.
- The app may only be framed by its own origin (the simulator).

## Deploy to Vercel

1. Import the repository in Vercel and set **Root Directory** to `apps/web`
   (keep "Include files outside the root directory" on; the app uses
   `packages/*`). The framework and pnpm workspace are detected automatically.
2. Add the environment variables from `.env.example` for Production (Preview
   deployments can stay in demo mode).
3. Every push now gets a preview URL such as
   `smartmirror-git-<branch>.vercel.app`; open `/simulator/echo-show-21` on it.

`vercel.json` skips builds for commits that do not touch the web app, its
packages or the lockfile.
