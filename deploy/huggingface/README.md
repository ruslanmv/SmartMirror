# Hugging Face deployment

The SmartMirror API runs as a [Docker Space](https://huggingface.co/spaces/ruslanmv/SmartMirror)
on port **7860**. Packaging lives in `hf/`; this folder uploads it.

## Deploy

```bash
HF_TOKEN=hf_... make space
# or: sh deploy/huggingface/deploy.sh

HF_TOKEN=hf_... HF_SPACE_REPO=you/your-space make space
DRY_RUN=1 make space                 # stage only, list files
STAGE_TO=/tmp/sm-space make space    # keep a copy to `docker build` locally
```

`deploy.sh` uploads the **committed HEAD**, not the working tree: a `git archive`
of `smartmirror/`, `services/`, `integrations/`, `packages/`, `pyproject.toml`,
and `LICENSE`, with:

| Staged as | From |
| --- | --- |
| `Dockerfile` | `hf/Dockerfile` |
| `README.md` | `hf/README.md` (Space card front matter) |
| `app.py` | `hf/app.py` |

The upload mirrors, so removed modules disappear from the Space. The Space
commit message names the source SHA.

CI workflow **Deploy to Hugging Face Space** runs the same script on every push
to `main` (and on `workflow_dispatch`). It needs the repository secret
`HF_TOKEN` (write access to the Space). If the secret is missing, the job
warns and exits 0.

## Space configuration

Set in the Space **Settings → Variables and secrets**:

| Name | Kind | Purpose |
| --- | --- | --- |
| `OLLABRIDGE_TOKEN` | **secret** | Paired token so try-on can call OllaBridge Cloud |
| `OLLABRIDGE_BASE_URL` | variable | Default `https://api.ollabridge.com` (script sets it) |
| `SMARTMIRROR_IMAGE_PROVIDER` | variable | Default `ollabridge-cloud` |
| `SMARTMIRROR_GROK_IMAGINE` | variable | `true` only when the cloud Grok adapter is on |
| `SMARTMIRROR_SHOPPING` | variable | `linkout` or `off` |

The xAI key stays on OllaBridge Cloud — never add `XAI_API_KEY` here.

## Local image smoke test

```bash
DRY_RUN=1 STAGE_TO=/tmp/sm-space make space
docker build -t smartmirror-space /tmp/sm-space
docker run --rm -p 7860:7860 smartmirror-space
# → http://127.0.0.1:7860/health
```

Storage on a free Space is ephemeral (`/app/data`). Attach persistent storage
in the Space settings if you need wardrobe photos to survive restarts.
