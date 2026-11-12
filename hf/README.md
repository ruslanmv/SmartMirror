---
title: SmartMirror
emoji: 🪞
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: AI wardrobe stylist powered by HomePilot
---

# SmartMirror

AI wardrobe stylist and virtual try-on API for large-screen clients (Echo Show /
companion web). Runs as a **Docker Space** on port **7860**.

**Production compute** is [HomePilot](https://homepilot.ruslanmv.com/) — the
HF web edition
([`claude/homepilot-hf-web-edition-410aea`](https://github.com/ruslanmv/HomePilot/tree/claude/homepilot-hf-web-edition-410aea)).
Try-on uses HomePilot's `/v1/edit-sessions/*` API. Grok Imagine via OllaBridge
Cloud is an **optional development** path for clothing-swap experiments, not
the default on this Space.

| Path | What it is |
| --- | --- |
| `/` | Space home |
| `/docs` | Interactive OpenAPI |
| `/health` | Liveness + configured provider |
| `/v1/capabilities` | Feature flags + HomePilot target |
| `/rpc` | HomePilot MCP tools |

## Defaults on this Space

- **SQLite** + **local media** under `/app/data` (ephemeral on a free Space).
- `SMARTMIRROR_IMAGE_PROVIDER=homepilot`
- `HOMEPILOT_BASE_URL=https://homepilot.ruslanmv.com`
- Set Space **secret** `HOMEPILOT_API_KEY` (HomePilot `API_KEY` as Bearer /
  `X-API-Key`) so try-on and MCP registration work against production.
- **Try-on needs HomePilot's edit-session sidecar.** Today production returns
  503 on `/v1/edit-sessions/*` until `EDIT_SESSION_URL` points at a live
  sidecar. Root `/chat` + `/upload` are not usable from API clients (nginx 405).
  Probe: `GET /v1/compute/probe` on this Space. Until the sidecar is up, use
  `SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud` + `OLLABRIDGE_TOKEN` only for
  Grok clothing-swap experiments.

## Register MCP with HomePilot

After the Space is up, register this gateway so HomePilot can call
`hp.smartmirror.*` tools:

```bash
HOMEPILOT_BASE_URL=https://homepilot.ruslanmv.com \
HOMEPILOT_API_KEY=… \
SMARTMIRROR_PUBLIC_MCP_URL=https://<this-space>.hf.space/rpc \
python scripts/register_homepilot.py
```

## Deploy from the GitHub repo

```bash
HF_TOKEN=hf_... make space
```

Pushes to `main` run **Deploy to Hugging Face Space** when `HF_TOKEN` is set.

Source: [github.com/ruslanmv/SmartMirror](https://github.com/ruslanmv/SmartMirror)
