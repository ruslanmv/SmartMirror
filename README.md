# SmartMirror

SmartMirror is an additive AI wardrobe stylist and virtual try-on application designed to integrate with [HomePilot](https://github.com/ruslanmv/HomePilot) through its MCP/agentic layer and with OllaBridge Cloud through the owner-scoped HomePilot mirror transport.

> Status: initial scaffold. The repository is intentionally independent from HomePilot and OllaBridge so all three projects can be upgraded separately.

## Architecture

```text
Echo Show / companion client
          |
          | HTTPS
          v
   OllaBridge Cloud
          |
          | owner-scoped mirror relay
          v
      HomePilot
          |
          | MCP / agentic invocation
          v
      SmartMirror
```

The first milestone provides:
- FastAPI backend with health/capability endpoints
- PostgreSQL/pgvector-ready persistence layer
- S3-compatible media configuration
- SmartMirror MCP tool surface for HomePilot
- OllaBridge mirror client
- Echo Show Android/Kotlin client skeleton
- Docker Compose local stack
- CI and contract tests

See `docs/architecture/overview.md` once the scaffold commit lands.
