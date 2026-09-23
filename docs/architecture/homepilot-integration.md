# HomePilot Integration

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
