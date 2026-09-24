# Contracts v1 (SmartMirror ⇄ OllaBridge ⇄ HomePilot)

Shared fixtures for the mirror plane. SmartMirror's Python and web tests load
them; HomePilot and OllaBridge Local test the same shapes in their own suites.

| File | What |
|---|---|
| `agentic-invoke.request.json` | job create body (`POST /v1/mirror/nodes/{node}/jobs`, HomePilot `POST /v1/node/jobs`) |
| `agentic-invoke.completed.json` / `.failed.json` | HomePilot job as returned by `GET …/jobs/{id}` |
| `images-edit.request.json` | try-on job create body (`resource_uri` resolved by OllaBridge Local) |
| `relay-envelope.json` | how OllaBridge Cloud wraps relay answers |
| `errors.json` | stable error codes and the HTTP status the web BFF maps them to |

Change them additively: new optional fields and new codes only.
