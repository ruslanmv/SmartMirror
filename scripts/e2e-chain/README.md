# End-to-end chain tests

Runs the whole path a paired screen uses, with real code on every hop that
belongs to the owner's home:

```
browser (Playwright) → apps/web BFF → OllaBridge Cloud (stand-in: cloud.py)
  → OllaBridge Local relay (real homepilot_mirror_relay.dispatch)
  → HomePilot node jobs (real agentic.invoke + images.edit; homepilot_node.py)
  → SmartMirror API /rpc (real)
```

Stand-ins: the cloud's own routing and pairing, Context Forge (a shim that
forwards `tools/call` to SmartMirror) and the ComfyUI render (inverts the photo).

| Suite | Covers |
|---|---|
| `chain.mjs` | pairing by code, wardrobe and suggestions through `agentic.invoke`, persona answer grounded in owned items, a tool outside the allow-list is refused |
| `tryon.mjs` | phone → screen photo hand-off, try-on through `images.edit`, preview, before/after |
| `closet.mjs` | phone closet scan, colour suggested on the PC, one-press confirm |
| `plans.mjs` | complete the look (link-out QR, "I bought it"), trip plan saved on the PC and deleted |

## Run

```sh
pnpm --filter @smartmirror/web build
HOMEPILOT_DIR=../HomePilot OLLABRIDGE_DIR=../ollabridge \
SM_PYTHON=.venv/bin/python HP_PYTHON=../HomePilot/.venv/bin/python \
PLAYWRIGHT_MODULE=$(npm root -g)/playwright/index.mjs \
scripts/e2e-chain/run.sh            # or: run.sh plans tryon
```

- HomePilot needs the `feature/mirror-agentic-invoke` branch; OllaBridge the
  `feature/homepilot-mirror-relay` branch.
- `HP_PYTHON` needs HomePilot's backend requirements plus Pillow and httpx.
- Ports 8100, 8765, 4101 and 3102 must be free. Logs and screenshots go to
  `$E2E_WORK` (default `/tmp/smartmirror-e2e`).
