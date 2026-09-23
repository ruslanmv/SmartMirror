# ADR 0002: Integrate with HomePilot through MCP

Status: Accepted

SmartMirror exposes HomePilot-compatible JSON-RPC `tools/list` and `tools/call` at `/rpc`. HomePilot discovers the tools through Context Forge. No wardrobe routes are added to HomePilot core.
