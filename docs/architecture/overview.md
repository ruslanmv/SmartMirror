# Architecture Overview

## Boundary

SmartMirror is an independent application. Its database, migrations, media, wardrobe logic and user preferences remain outside HomePilot and OllaBridge.

```text
Echo/Phone
   |
OllaBridge Cloud
   |
HomePilot Mirror
   |
HomePilot MCP / Compute
   |
SmartMirror
```

## Responsibility split

| Component | Owns |
|---|---|
| SmartMirror | wardrobe, style profile, outfit ranking, captures, try-on jobs |
| HomePilot | MCP orchestration, LLM/vision/image compute, personas |
| OllaBridge | identity, pairing, owner-scoped remote relay, temporary media |
| Echo/companion | interaction, capture, preview |

## Local ports

- SmartMirror API/MCP: 8100
- HomePilot: 8000
- Context Forge: 4444
- MinIO: 9000/9001 in development only

## Non-destructive rule

Stopping or upgrading SmartMirror must not disable HomePilot. Stopping OllaBridge must not disable local SmartMirror/HomePilot use.
