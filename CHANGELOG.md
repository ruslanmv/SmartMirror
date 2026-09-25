# Changelog

All notable changes to SmartMirror will be documented here.

## [Unreleased]

### Added
- Stylist v2 on the owner's PC: complete outfits (base, layer, shoes, bag) scored by
  occasion, colour and harmony, with titles and explanations that cite only owned pieces;
  "Plan my week" / "Pack for a trip" saved as outfit plans (shown in Looks); "Complete
  the look" names missing pieces and, when enabled (`SMARTMIRROR_SHOPPING=linkout` plus
  Settings → Shopping suggestions), shows an Amazon search as a QR for the phone.
- Pairing with OllaBridge like the 3D Avatar Chatbot: TV-style "show a code"
  (code + QR, confirm on the phone, `/device/start` + `/device/poll`) and a
  "type a code" fallback (`/pair`), SmartMirror client identity, sealed pending
  pairing cookie, paired-screen card with "Forget this screen".
- Stylist persona template for HomePilot (`integrations/homepilot/personas`).
- Add clothes with AI on the owner's PC: phone closet scan or upload → colour (and, with the
  optional ML extra, category) suggested → one-press confirm in a review queue; photos in the
  wardrobe grid; benchmark tool.
- AI try-on on the owner's PC: photos stored at home via `hp.smartmirror.capture_upload`
  (EXIF removed, body photos expire), HomePilot `images.edit` provider (cloud fallback),
  background jobs + worker, preview returned as a small image with a disclaimer and
  before/after; phone → screen photo hand-off across devices with a sealed ticket.
- Backend foundations: assets, classification runs, outfit sets, shopping candidates,
  capture sessions, audit events (migration `0002_foundations`); media store; retention
  sweep worker; delete-all endpoint and `hp.smartmirror.profile_delete`; contracts v1.
- Tool calls from anywhere through HomePilot's `agentic.invoke` node job (OllaBridge mirror
  plane): node discovery, remembered node, actionable errors; "Not paired" status pill.
- Stylist answers from the owner's HomePilot persona (OllaBridge `/v1/chat/completions`),
  grounded in the owned items of the top outfit, read aloud; Settings → Stylist.
- `apps/web`: web-first Next.js SmartMirror UI for Vercel (home, stylist, wardrobe,
  capture, try-on, recent looks, pairing) with D-pad spatial navigation.
- Echo Show 21 simulator (`/simulator/*`) with three device profiles, live capability
  toggles, remote control, Alexa console, companion phone and bridge log.
- BFF with demo / direct / OllaBridge backends, sealed HttpOnly pairing sessions and a
  contract-based MCP tool allow-list.
- `packages/ui` design system and `packages/device-capabilities`.
- Alexa skill (`integrations/alexa`) launching the web UI via `Alexa.Presentation.HTML`
  with an APL fallback.
- MCP tools `hp.smartmirror.wardrobe_add` and `hp.smartmirror.job_get`.
- Web CI workflow.
- Backwards-compatible camera layer: modern and legacy `getUserMedia`, constraint
  fallback, camera probing; web camera usable in the browser, the Echo WebView and
  Alexa HTML sessions, with native and phone fallbacks.
- Snap from the live mirror (tap / OK / "Alexa, take my photo" → 3·2·1 → next
  step: Style me, Try it on, Make it art), Camera-on privacy pill, and the
  mirror UX guide in `docs/ux/mirror-experience.md`.
- Live mirror on by default; Settings screen; fill-screen Portrait mode with a
  real-mirror view and framed paintings (oil, watercolour, charcoal, vintage;
  gilded, walnut and gallery frames; wall or full-screen layout; idle auto-start;
  `PortraitIntent` for Alexa).
- Live mirror on the home screen, `/smartmirror/camera-test` diagnostics page and an
  `echo-show-21-alexa` simulator profile for real-time camera testing on Vercel.

### Changed
- The Echo Show app is now a thin WebView shell with a native capture bridge.

## [0.1.0] - 2026-09-23

### Added
- FastAPI SmartMirror service.
- Wardrobe, styling and try-on job development endpoints.
- HomePilot-compatible JSON-RPC MCP endpoint.
- HomePilot gateway registration helper.
- OllaBridge private mirror client.
- PostgreSQL/pgvector-ready Docker stack.
- Echo Show Android client scaffold.
- CI, architecture, privacy and device-testing documentation.
