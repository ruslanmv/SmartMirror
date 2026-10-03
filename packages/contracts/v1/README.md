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

`arguments._meta` is reserved: the web BFF sets `trace_id` (one id for the call on
every hop, logged by the BFF and SmartMirror) and `idempotency_key` (creating tools
run once per key). SmartMirror removes it before a tool runs; a browser cannot set it.

The web suite drives the BFF with these exact files (`apps/web/test/contracts.test.ts`),
and the Python suite checks them against the tool contract and, when a checkout is
available, HomePilot's `agentic.invoke` (`tests/contracts/test_v1_fixtures.py`).

Change them additively: new optional fields and new codes only.
