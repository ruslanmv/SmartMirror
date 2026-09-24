# Changelog

All notable changes to SmartMirror will be documented here.

## [Unreleased]

### Added
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
