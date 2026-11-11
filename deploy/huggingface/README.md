# Hugging Face deployment

The SmartMirror API runs as a [Docker Space](https://huggingface.co/spaces/ruslanmv/SmartMirror)
on port **7860**. Packaging lives in `hf/`; this folder uploads it.

## Production vs development compute

| Path | Role | Target |
| --- | --- | --- |
| **HomePilot** (default) | Production try-on / edit-session | [homepilot.ruslanmv.com](https://homepilot.ruslanmv.com/) — HF web edition [`claude/homepilot-hf-web-edition-410aea`](https://github.com/ruslanmv/HomePilot/tree/claude/homepilot-hf-web-edition-410aea) |
| **OllaBridge Cloud + Grok Imagine** | Optional clothing-swap experiments | Set `SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud` + `OLLABRIDGE_TOKEN` |

The Space defaults to HomePilot. Do **not** put `XAI_API_KEY` on the Space.

## Deploy

```bash
HF_TOKEN=hf_... make space
DRY_RUN=1 make space
STAGE_TO=/tmp/sm-space make space
```

`deploy.sh` uploads **committed HEAD** only: a `git archive` of the app tree
and `hf/`, then relocates `hf/Dockerfile` → Space `Dockerfile` and
`hf/README.md` → Space card. Working-tree edits under `hf/` are never copied.

CI **Deploy to Hugging Face Space** runs on every push to `main` when the
repository secret `HF_TOKEN` is set.

## Space secrets / variables

| Name | Kind | Purpose |
| --- | --- | --- |
| `HOMEPILOT_API_KEY` | **secret** | HomePilot `API_KEY` (Bearer / `X-API-Key`) |
| `HOMEPILOT_BASE_URL` | variable | Default `https://homepilot.ruslanmv.com` |
| `SMARTMIRROR_IMAGE_PROVIDER` | variable | Default `homepilot` |
| `OLLABRIDGE_TOKEN` | secret | Only for Grok/cloud swap experiments |
| `OLLABRIDGE_BASE_URL` | variable | Default `https://api.ollabridge.com` |

## Register MCP with production HomePilot

```bash
HOMEPILOT_BASE_URL=https://homepilot.ruslanmv.com \
HOMEPILOT_API_KEY="$HOMEPILOT_API_KEY" \
SMARTMIRROR_PUBLIC_MCP_URL="https://<space>.hf.space/rpc" \
python scripts/register_homepilot.py
```

## Local image smoke test

```bash
DRY_RUN=1 STAGE_TO=/tmp/sm-space make space
docker build -t smartmirror-space /tmp/sm-space
docker run --rm -p 7860:7860 \
  -e HOMEPILOT_API_KEY=… \
  smartmirror-space
curl -s http://127.0.0.1:7860/health
```
