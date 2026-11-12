#!/usr/bin/env sh
# Publish this repository to the Hugging Face Docker Space ruslanmv/SmartMirror.
#
#   HF_TOKEN=hf_... sh deploy/huggingface/deploy.sh
#   HF_TOKEN=hf_... HF_SPACE_REPO=you/your-space sh deploy/huggingface/deploy.sh
#   DRY_RUN=1 sh deploy/huggingface/deploy.sh          # stage only, print the tree
#   STAGE_TO=/tmp/smartmirror-space sh deploy/huggingface/deploy.sh
#
# The Space receives the committed HEAD only: a `git archive` of the app tree
# and of hf/. Uncommitted edits are never uploaded. The Space commit names the
# source SHA. The upload mirrors, so removed modules disappear from the Space
# (huggingface_hub never deletes .gitattributes).
set -eu

HF_SPACE_REPO="${HF_SPACE_REPO:-ruslanmv/SmartMirror}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"

# App tree the Space Dockerfile COPYs, plus hf/ (relocated to Space root below).
PATHS="pyproject.toml LICENSE smartmirror services integrations packages hf"

# shellcheck disable=SC2086
if [ -n "$(git status --porcelain -- $PATHS deploy/huggingface)" ]; then
  echo "note: uncommitted changes under the deployed paths are NOT deployed; HEAD is." >&2
fi

SHA="$(git rev-parse --short HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# shellcheck disable=SC2086
git archive --format=tar HEAD $PATHS | tar -x -C "$STAGE"

# Space root layout: Docker + card + uvicorn entry from the *archived* hf/.
mv "$STAGE/hf/Dockerfile" "$STAGE/Dockerfile"
mv "$STAGE/hf/app.py" "$STAGE/app.py"
mv "$STAGE/hf/README.md" "$STAGE/README.md"
if [ -f "$STAGE/hf/.dockerignore" ]; then
  mv "$STAGE/hf/.dockerignore" "$STAGE/.dockerignore"
fi
rm -rf "$STAGE/hf"

# Pip needs a README.md for the project metadata; the Space card is that file.

echo "Staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files from $SHA ($(du -sh "$STAGE" | cut -f1)) for $HF_SPACE_REPO"
if [ -n "${STAGE_TO:-}" ]; then
  rm -rf "$STAGE_TO" && cp -R "$STAGE" "$STAGE_TO"
fi
if [ "${DRY_RUN:-0}" = "1" ]; then
  (cd "$STAGE" && find . -maxdepth 2 | sort)
  exit 0
fi

: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token with write access to $HF_SPACE_REPO}"
export HF_TOKEN

hf upload "$HF_SPACE_REPO" "$STAGE" . --repo-type=space --delete='*' \
  --commit-message="Deploy $SHA" \
  --commit-description="From SmartMirror $(git rev-parse HEAD)"

# Non-secret Space variables. Secrets (HOMEPILOT_API_KEY, …) are set by hand.
python3 - "$HF_SPACE_REPO" <<'EOF'
import sys

from huggingface_hub import HfApi

repo = sys.argv[1]
api = HfApi()
variables = {
    "SMARTMIRROR_ENV": "space",
    # Production compute = HomePilot HF web edition.
    "SMARTMIRROR_IMAGE_PROVIDER": "homepilot",
    "HOMEPILOT_BASE_URL": "https://homepilot.ruslanmv.com",
    "SMARTMIRROR_SHOPPING": "linkout",
    # Optional Grok clothing-swap path (off unless you change IMAGE_PROVIDER).
    "OLLABRIDGE_BASE_URL": "https://api.ollabridge.com",
}
domains = api.get_space_runtime(repo).raw.get("domains") or []
if domains:
    variables["SMARTMIRROR_PUBLIC_MCP_URL"] = f"https://{domains[0]['domain']}/rpc"
for key, value in variables.items():
    api.add_space_variable(repo, key, value)
    print(f"  {key}={value}")
print(f"Building: https://huggingface.co/spaces/{repo}?logs=build")
print("Set Space secret HOMEPILOT_API_KEY for production try-on against homepilot.ruslanmv.com.")
print("Optional: OLLABRIDGE_TOKEN only for SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud experiments.")
EOF
