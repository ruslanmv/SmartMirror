---
title: SmartMirror
emoji: 🪞
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: AI wardrobe stylist and virtual try-on API
---

# SmartMirror

AI wardrobe stylist and virtual try-on API for large-screen clients (Echo Show /
companion web). Runs as a **Docker Space** on port **7860**.

| Path | What it is |
| --- | --- |
| `/` | Space home |
| `/docs` | Interactive OpenAPI |
| `/health` | Liveness |
| `/v1/capabilities` | Feature flags |
| `/rpc` | HomePilot MCP tools |

## Defaults on this Space

- **SQLite** + **local media** under `/app/data` (ephemeral on a free Space —
  restart clears wardrobe photos and previews).
- Try-on provider: **OllaBridge Cloud** (`SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud`).
  Set the Space **secret** `OLLABRIDGE_TOKEN` (paired device / API token). The
  xAI key never lives here — it stays on OllaBridge Cloud.
- Grok clothing-swap references stay off until both
  `SMARTMIRROR_GROK_IMAGINE=true` (Space variable) and
  `OLLABRIDGE_GROK_IMAGINE_ENABLED` on the cloud are set.

## Deploy from the GitHub repo

```bash
HF_TOKEN=hf_... make space
# or: sh deploy/huggingface/deploy.sh
```

Pushes to `main` run the same script via **Deploy to Hugging Face Space** CI
when the repository secret `HF_TOKEN` is set.

Source: [github.com/ruslanmv/SmartMirror](https://github.com/ruslanmv/SmartMirror)
