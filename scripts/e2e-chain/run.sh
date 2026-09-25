#!/bin/sh
# End-to-end chain: browser → web BFF → (stand-in) OllaBridge Cloud → OllaBridge
# Local relay → HomePilot node jobs → SmartMirror API. Only the cloud's own
# routing, Context Forge and the ComfyUI render are stand-ins.
#
#   HOMEPILOT_DIR=../HomePilot OLLABRIDGE_DIR=../ollabridge \
#   SM_PYTHON=.venv/bin/python HP_PYTHON=../HomePilot/.venv/bin/python \
#   PLAYWRIGHT_MODULE=/usr/lib/node_modules/playwright/index.mjs \
#   scripts/e2e-chain/run.sh [chain tryon closet plans]
#
# Build the web app first (pnpm --filter @smartmirror/web build).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
: "${HOMEPILOT_DIR:?set HOMEPILOT_DIR to a HomePilot checkout}"
: "${OLLABRIDGE_DIR:?set OLLABRIDGE_DIR to an OllaBridge checkout}"
SM_PYTHON=${SM_PYTHON:-python}
HP_PYTHON=${HP_PYTHON:-python}
export E2E_WORK=${E2E_WORK:-/tmp/smartmirror-e2e}
export HOMEPILOT_DIR OLLABRIDGE_DIR
SUITES=${*:-chain tryon closet plans}

for port in 8100 8765 4101 3102; do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
    echo "port $port is already in use; stop that server first" >&2
    exit 2
  fi
done

rm -rf "$E2E_WORK" && mkdir -p "$E2E_WORK"
PIDS=""
stop() { for p in $PIDS; do kill "$p" 2>/dev/null || true; done; }
trap stop EXIT INT TERM

cd "$ROOT"
SMARTMIRROR_DATABASE_URL="sqlite:///$E2E_WORK/smartmirror.db" SMARTMIRROR_MEDIA_DIR="$E2E_WORK/media" \
  SMARTMIRROR_STORAGE=local SMARTMIRROR_IMAGE_PROVIDER=homepilot HOMEPILOT_BASE_URL=http://127.0.0.1:8765 \
  SMARTMIRROR_SHOPPING=linkout AMAZON_PARTNER_TAG=chain-21 SMARTMIRROR_ML_MODEL= \
  "$SM_PYTHON" -m uvicorn services.api.app.main:app --port 8100 >"$E2E_WORK/smartmirror.log" 2>&1 &
PIDS="$PIDS $!"
cd "$HERE"
"$HP_PYTHON" -m uvicorn homepilot_node:app --port 8765 >"$E2E_WORK/homepilot.log" 2>&1 &
PIDS="$PIDS $!"
"$HP_PYTHON" -m uvicorn cloud:app --port 4101 >"$E2E_WORK/cloud.log" 2>&1 &
PIDS="$PIDS $!"
cd "$ROOT/apps/web"
SMARTMIRROR_BACKEND=ollabridge OLLABRIDGE_BASE_URL=http://127.0.0.1:4101 \
  SMARTMIRROR_SESSION_SECRET=0123456789abcdef0123456789abcdef-e2e \
  ./node_modules/.bin/next start -p 3102 >"$E2E_WORK/web.log" 2>&1 &
PIDS="$PIDS $!"

for _ in $(seq 1 60); do
  if curl -fs -o /dev/null http://127.0.0.1:8100/health && curl -fs -o /dev/null http://127.0.0.1:3102/api/health \
    && curl -s -o /dev/null http://127.0.0.1:8765/ && curl -s -o /dev/null http://127.0.0.1:4101/; then
    break
  fi
  sleep 1
done

cd "$HERE"
FAILED=0
for s in $SUITES; do
  echo "=== $s"
  node "$s.mjs" || FAILED=1
done
echo "logs and screenshots: $E2E_WORK"
exit $FAILED
