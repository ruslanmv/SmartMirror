# HomePilot Integration

**Production source of truth** for compute is the HomePilot HF web edition:

- Live: [https://homepilot.ruslanmv.com/](https://homepilot.ruslanmv.com/)
- Branch: [`claude/homepilot-hf-web-edition-410aea`](https://github.com/ruslanmv/HomePilot/tree/claude/homepilot-hf-web-edition-410aea)

SmartMirror defaults to that host (`HOMEPILOT_BASE_URL`,
`SMARTMIRROR_IMAGE_PROVIDER=homepilot`). Try-on uses HomePilot's
`/v1/edit-sessions/{id}/image` and `/message` API
(`HomePilotEditSessionProvider`).

### Production gap (verified Nov 2026)

| Call | Result on `homepilot.ruslanmv.com` |
|---|---|
| `POST /v1/edit-sessions/...` | **503** — cannot connect to edit-session at `http://edit-session:8010` (`EDIT_SESSION_URL`) |
| `POST /chat`, `POST /upload` | **405** — nginx `try_files` on `/` rejects POST for API clients |
| `POST /v1/files/upload`, `/v1/enhance`, `/v1/edit/identity` | Reach the app (auth / schema apply) but are not general clothing-edit |

**HomePilot ops needed for production try-on:** run the edit-session sidecar
(or point `EDIT_SESSION_URL` at one), *or* expose chat/upload under `/v1/` so
nginx's API regex forwards POSTs. Until then SmartMirror fails closed with
`CAPABILITY_UNAVAILABLE` instead of hanging. Optional clothing-swap experiments
can use `SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud` + Grok.

SmartMirror matches HomePilot's existing MCP-server shape:

- `GET /health`
- `POST /rpc`
- JSON-RPC `tools/list`
- JSON-RPC `tools/call`

Tool names use the HomePilot `hp.` namespace.

## Registration

`scripts/register_homepilot.py` calls:

```text
POST /v1/agentic/register/gateway
```

with an HTTP gateway pointing to SmartMirror's `/rpc` endpoint and requests automatic tool refresh.

## Proposed generic HomePilot changes for remote SmartMirror

These changes belong in HomePilot and should remain SmartMirror-agnostic.

### 1. Allow-listed agentic node job

Add a mirror node-job operation such as:

```text
agentic.invoke
scope: mcp:invoke
```

The operation should route to HomePilot's existing agentic/MCP invocation layer.

Required controls:

- feature flag, default off;
- explicit allowed-tool patterns;
- reject arbitrary URLs or shell execution;
- preserve current owner-scoped mirror checks;
- audit tool name, caller and job id without logging sensitive media.

Suggested flags:

```env
HOMEPILOT_MIRROR_MCP_ENABLED=false
HOMEPILOT_MIRROR_ALLOWED_TOOLS=hp.smartmirror.*
```

### 2. Image edit node job

HomePilot already has a compute-provider `edit_image()` seam and advertises image-edit capability in its node manifest. The node-job plane should expose a generic `images.edit` operation through that compute abstraction.

### 3. Safe resource references

Remote jobs should accept signed/authorized media references, never arbitrary URLs. Resource fetching must defend against SSRF and enforce content type and size limits.

## No SmartMirror domain models in HomePilot

Do not add wardrobe items, outfits, body captures, style profiles or garment embeddings to HomePilot.
