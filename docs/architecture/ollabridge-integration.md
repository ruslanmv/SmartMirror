# OllaBridge Integration

SmartMirror does not require wardrobe-specific OllaBridge routes.

The client adapter uses OllaBridge Cloud's private HomePilot mirror:

```text
GET  /v1/mirror/nodes
POST /v1/mirror/nodes/{node_id}/jobs
GET  /v1/mirror/jobs/{job_id}?node_id={node_id}
POST /v1/media/upload
```

OllaBridge remains responsible for:

- pairing/device tokens;
- user identity resolution;
- owner-to-node authorization;
- outbound WebSocket relay;
- temporary media transport.

## Expected remote flow

```text
Echo
  -> OllaBridge authenticated request
  -> owner's HomePilot node
  -> allow-listed agentic job
  -> SmartMirror MCP tool
```

The Echo client must never receive a direct LAN HomePilot URL as its normal remote configuration.
