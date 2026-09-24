# Upgrade plan: HomePilot + SmartMirror

Status: **Plan (for review)** · Date: 24 September 2026
Baselines:
- HomePilot `claude/meetingsense-grounded-chat` @ `2168b22`
- SmartMirror `claude/upbeat-maxwell-sky163` @ `e45f553`
- OllaBridge Cloud `main` @ `e4c3c0a`
- OllaBridge Local `ruslanmv/ollabridge` `main` @ `b07dac0` (the link between HomePilot and OllaBridge Cloud)
- 3D Avatar Chatbot `main` @ `1011e0c` (reference client, not changed)

Goal: deliver the capabilities designed so far:

- **link the Smart Mirror to the owner's HomePilot through OllaBridge Cloud, the
  same way the 3D Avatar Chatbot does** (pair with a code, then chat with a
  HomePilot persona), see §2;
- remote Echo → SmartMirror through OllaBridge;
- wardrobe ingestion with on-device ML;
- outfit sets;
- AI try-on;
- shopping.

The platform contract stays unchanged:

> **SmartMirror owns fashion. HomePilot supplies generic compute and MCP. OllaBridge supplies connectivity.**
> No wardrobe concepts enter HomePilot or OllaBridge.

---

## 1. Where we are (verified in code)

### HomePilot (this branch)

| Area | What exists | Gap for SmartMirror |
|---|---|---|
| Node jobs `backend/app/node_jobs.py` | `register_operation(name, scope, handler)`; operations `chat.completions`, `images.generate`, `videos.generate`; flag `HOMEPILOT_MIRROR_JOBS_ENABLED`; endpoints are **localhost-only** | no `agentic.invoke`, no `images.edit`; jobs live in an **in-memory dict** (lost on restart); handlers are sync in a thread |
| Manifest `node_manifest.py` | `_capabilities()` advertises `images.edit` when ComfyUI is ready | **advertises a capability no job handler serves** |
| Compute `compute/router.py`, `local.py`, `ollabridge_cloud.py` | `ComputeRouter.edit_image()`; **both** providers implement `edit_image` (ComfyUI workflow `edit`; cloud `/v1/images/edits`) | only needs exposing as a job |
| Agentic `agentic/routes.py`, `client.py`, `policy.py`, `tool_policy.py` | `/v1/agentic/register/{tool,gateway,server}`; `/v1/agentic/invoke` routes non-built-in intents to Context Forge via `ContextForgeClient.invoke_tool` (JSON-RPC); `is_allowed()` + `apply_policy()` | no remote path to invoke a tool from a mirror job |
| Mirror BFF `mirror_proxy.py` | forwards job create/get/cancel to OllaBridge; **already accepts `resource_uri`** on job create; RPC read-only allow-list | none, beyond documenting `agentic.invoke` |
| Media `media_resolver.py` | resolves `media://persona/...` only | no resolver for OllaBridge media refs |
| Outbound safety `compute/netguard.py` | `validate_outbound_url()` (blocks link-local/metadata; private ranges optional) | reuse for the media resolver |
| Artifacts `node_artifacts.py` | TTL artifacts | reuse for try-on outputs |
| Routines `routines/actions.py` | actions can call **named Forge tools** (`_invoke_named_tool`) | a scheduled "outfit of the day" becomes pure configuration |
| MeetingSense `meetingsense/ask.py` | grounded answers that cite only what was supplied | pattern for a stylist that cites real wardrobe items |

### SmartMirror

| Area | Status |
|---|---|
| Web (`apps/web`) | ✅ done: UI, simulator, cameras, snap flow, portrait, BFF (demo/direct/ollabridge modes) |
| Echo shell / Alexa skill | ✅ thin shell with native bridge; skill with HTML launch + APL fallback |
| Backend (`services/api`, `smartmirror/`) | ⚠️ scaffold: SQLite default, 5 MCP tools (`hp.smartmirror.*`), deterministic stylist, try-on jobs stay `queued`, no media storage, no ML |
| BFF → OllaBridge | sends operation `OLLABRIDGE_MCP_OPERATION` (default `mcp.tools_call`) with `{server, tool, arguments}`, which **must be aligned** with HomePilot's new `agentic.invoke` |
| Companion handoff | same-browser only (BroadcastChannel); cross-device needs a relay |
| Pairing screen `app/smartmirror/pairing` | asks for a **6-digit numeric** code; OllaBridge issues **`ABCD-1234`** codes (letters + digits), so a real code cannot be typed today |
| Pair route `api/session/pair` | posts `{code, device_name, device_type}` to `OLLABRIDGE_PAIRING_PATH` (unset by default); OllaBridge ignores those field names and answers `/pair` with `{ok, token, device_id}` |

### OllaBridge Cloud (`main`)

| Area | What exists | Meaning for SmartMirror |
|---|---|---|
| Pairing `api/device_pair.py` | owner signs in and starts pairing in the dashboard → `ABCD-1234` code; `POST /pair {code, label, client}` → `{ok, token, device_id}`; `GET /pair/info`; `POST /device/pair-simple` | same endpoint the 3D Avatar uses; no new code needed |
| Identity `core/user_context.py` | a paired **device token resolves to its owner's `user_id`** (`resolve_device_token_user`); anonymous devices are refused | the mirror's token can call the owner-scoped mirror plane |
| Chat plane (Plane A) `api/ollama_proxy.py` | OpenAI-compatible `/v1/models`, `/v1/chat/completions`; `persona:*` / `personality:*` models routed to HomePilot; `X-Client-Type`, `X-Client-Capabilities`, `X-Include-Persona-Context` forwarded to HomePilot | stylist conversation and voice work **today**, with no HomePilot change |
| Mirror plane (Plane B) `api/mirror.py` | `/v1/mirror/nodes`, `…/manifest`, `…/rpc` (read-only allow-list), `…/jobs`, `/v1/mirror/jobs/{id}`; ownership gate on every call; **off unless `HOMEPILOT_MIRROR_ENABLED=true`** | tool calls and try-on jobs (needs HP-1 / HP-2 for the operations) |
| Connector `connector/bridge.py` | a standalone PC-side bridge in the cloud repo that maps `homepilot.mirror.*` relay ops onto HomePilot `/v1/node/*` | reference only; **the owner's PC runs OllaBridge Local**, which does not have these ops yet (next table) |
| Media `api/media_proxy.py` | `POST /v1/media/upload`, cached with dedupe and expiry | phone photos for W-3 / HP-3 |
| Client names `api/client_id.py` | curated `KNOWN_CLIENTS` list (3D Avatar, GitPilot, HomePilot, …) | **no `smartmirror` entry**: the device would show as "Web App" (OB-1) |

### OllaBridge Local (`ruslanmv/ollabridge`): the link on the owner's PC

This gateway runs next to HomePilot. It pairs with OllaBridge Cloud using the
TV-style device flow (`cloud/api_client.py` `device_start` / `device_poll`),
dials out over `wss://…/relay/connect`, and answers the cloud's relay requests
in `cloud/bridge_manager.py` `_handle_request`.

| Relay op from the cloud | Handled by OllaBridge Local | Used by |
|---|---|---|
| `chat` | ✅ forwarded to the local gateway `/v1/chat/completions`, which routes `persona:*` to HomePilot; only `X-Client-Type` is passed through | Plane A (3D Avatar today; SmartMirror W-7) |
| `models` | ✅ | `/v1/models` |
| `media_fetch` | ✅ home → cloud (serves HomePilot files as base64) | persona images |
| `homepilot.image.capability` / `homepilot.image.generate` | ✅ (`cloud/homepilot_image_relay.py`) | cloud `/v1/media/homepilot/*` |
| `homepilot.mirror.manifest` / `.rpc` / `.job.create` / `.job.get` / `.job.cancel` | ❌ **answered with "Unsupported operation"** | Plane B: every SmartMirror tool call and try-on job |

**Consequence:** Plane A works end-to-end today. Plane B does not, even with
`HOMEPILOT_MIRROR_ENABLED=true` on the cloud, until OllaBridge Local learns the
mirror ops (**OL-1**). This is the only blocker in the transport path.

### 3D Avatar Chatbot (reference client)

How it links to HomePilot (`src/LLMManager.js`, `src/PersonaContextBridge.js`):

1. Base URL defaults to `https://app.ollabridge.com` (root, no `/v1`).
2. **Device pairing:** the user types the dashboard code; `POST {base}/pair {code, label}`
   (code upper-cased, dashes removed); the returned `token` is stored as `pair_token`.
3. Every call sends `Authorization: Bearer <token>` plus
   `X-Client-Type: vr-chatbot` and `X-Client-Capabilities: text_chat,voice_output,…`.
4. `GET /v1/models` lists the owner's models; the user picks a **`persona:<id>`**.
5. `POST /v1/chat/completions` with that model. For a remote persona it **omits its
   own system prompt** (HomePilot builds a better one) and sends
   `X-Include-Persona-Context: true`, which returns tone/emotion used to drive the
   avatar and TTS.
6. Relayed chat retries transient `502/503/504` with backoff; errors are turned
   into plain-language messages ("gateway did not answer in time", "pairing code
   expired").

---

## 2. Linking model: the Smart Mirror as an OllaBridge Cloud client

The mirror follows the 3D Avatar pattern for **identity and chat**, and adds the
mirror plane for **tools and jobs**. One pairing gives both.

```text
 Echo Show 21 / browser              Vercel (apps/web BFF)                 OllaBridge Cloud                 Owner's PC
┌─────────────────────┐   HTTPS    ┌──────────────────────┐   HTTPS    ┌─────────────────────┐   WSS    ┌──────────────────────┐
│ /smartmirror UI     │──────────▶│ /api/session/pair    │──────────▶│ POST /pair           │          │ OllaBridge Local     │
│ (no token, ever)    │  HttpOnly  │ sealed cookie holds  │  Bearer    │ device token → owner │◀────────│ (ruslanmv/ollabridge)│
│                     │  cookie    │ the device token     │  device    │                      │  relay   │                      │
│ Stylist chat, voice │──────────▶│ /api/stylist/chat    │──────────▶│ Plane A              │─────────▶│ HomePilot            │
│                     │           │                      │            │ /v1/chat/completions │          │  persona "Stylist"   │
│                     │           │                      │            │ model persona:<id>   │          │                      │
│ Wardrobe, try-on,   │──────────▶│ /api/tools/[tool]    │──────────▶│ Plane B              │─────────▶│  /v1/node/jobs       │
│ sets, shopping      │           │ (contract allow-list)│            │ /v1/mirror/nodes/…   │          │  agentic.invoke ──▶  │
└─────────────────────┘           └──────────────────────┘            └─────────────────────┘          │  SmartMirror MCP     │
                                                                                                        └──────────────────────┘
```

| | 3D Avatar Chatbot | Smart Mirror |
|---|---|---|
| Pairing | `POST /pair {code, label}` | same, plus the `client` block (`name: "smartmirror"`, version, platform) |
| Where the token lives | browser `localStorage` | **server-side only**, sealed in an HttpOnly cookie (project rule: no `NEXT_PUBLIC_OLLABRIDGE_TOKEN`) |
| CORS | needs `CORS_ORIGINS` or its proxy | not needed; the BFF calls OllaBridge server-to-server |
| Client headers | `X-Client-Type: vr-chatbot` | `X-Client-Type: smart-mirror`, `X-Client-Capabilities: text_chat,voice_output,image_panel,camera,tryon` |
| Chat model | user picks `persona:<id>` | owner picks the stylist persona once (Settings); default from `OLLABRIDGE_STYLIST_MODEL` |
| System prompt | skipped for remote personas | skipped; SmartMirror only adds a **grounding block** (the owned items chosen by the tools) |
| Persona context | drives avatar emotion and TTS | drives the stylist's voice rate and tone on the Echo |
| Tools / jobs | none | Plane B: `agentic.invoke` (HP-1), `images.edit` (HP-2) |

**Why two planes.** Plane A gives the conversational stylist immediately, using
features that already ship. Plane B keeps structured data (wardrobe items, sets,
try-on images) off the chat channel, behind the tool allow-lists in the BFF,
OllaBridge and HomePilot.

**Quick win.** Pairing and persona chat need **no HomePilot or OllaBridge code**:
only W-0 and W-7 in SmartMirror. That becomes milestone M1a (§6).

---

## 3. Capability → work matrix

| Capability | HomePilot | SmartMirror backend | SmartMirror web |
|---|---|---|---|
| Pair the mirror with the owner's OllaBridge account | none | none | **W-0** real `/pair` flow (OB-1 names the device) |
| Talk to the HomePilot stylist persona (voice + screen) | persona configured by the owner | none | **W-7** Plane A chat |
| Echo reaches SmartMirror remotely | **HP-1** `agentic.invoke` + **OL-1** relay in OllaBridge Local | SM-4 tool contract | W-1 align BFF operation |
| Try-on renders for real | **HP-2** `images.edit` job, **HP-4** durable jobs | SM-6 HomePilot try-on provider | W-4 real preview + progress |
| Photos travel phone → home safely | **OL-2** media resolution, **HP-3** input checks | SM-2 media ingest + storage | W-3 cross-device companion |
| Add clothes with AI classification | none | **SM-3** ML worker, SM-1 schema | W-2 add-clothes + review queue |
| Outfit sets + grounded stylist | none (LLM via existing chat) | **SM-5** scorer, sets, gap analysis, citations | W-5 sets UI |
| Shopping ("complete the look") | none | **SM-7** providers (link-out → Creators) | W-6 complete-the-look + opt-in |
| Outfit of the day (scheduled) | **HP-6** routine tool action (config) | tool `style_suggest` | display on home |
| Privacy (retention/deletion) | artifact TTL (exists) | **SM-8** retention + delete-all | Settings → delete data |

---

## 4. HomePilot workstream (generic PRs, all feature-flagged, default OFF)

None of these PRs mention wardrobes. Each one is independently useful.

### HP-1 · `feat(mirror): allow-listed agentic.invoke node job`
- `register_operation("agentic.invoke", "mcp:invoke", _op_agentic_invoke)` in `node_jobs.py`.
- Params: `{"tool": str, "arguments": object, "timeout_s"?: number}`.
- Allow-list: `HOMEPILOT_MIRROR_MCP_ENABLED` (default `false`) +
  `HOMEPILOT_MIRROR_ALLOWED_TOOLS` (comma-separated globs, default **empty = deny**).
  Match with `fnmatch`; reject anything else with `tool_not_allowed`.
- Execution: reuse the Context Forge path already used by `/v1/agentic/invoke`
  (`ContextForgeClient.invoke_tool`). The handler is sync-in-thread, so run the
  coroutine with `asyncio.run` inside the job thread. Honour cancel between steps.
- Output: normalise `{"result": <structuredContent|parsed text>, "tool": name}`.
  Log only tool name, duration and status, **never arguments** (they may carry photos or prompts).
- Manifest: add `agentic.invoke` to capabilities only when the flag is on.

### HP-2 · `feat(compute): images.edit node job`
- `register_operation("images.edit", "image:run", _op_images_edit)` →
  `ComputeRouter.edit_image(prompt, image, model?, workflow?, **extra)`.
- `image` accepts an artifact id, a `resource_uri` (HP-3) or base64 up to a size cap.
- Output images saved as `node_artifacts` (TTL) and returned as artifact ids.
- **Fix the manifest mismatch:** derive advertised capabilities from registered
  operations plus service readiness, so no capability is advertised without a handler.

### HP-3 · `feat(mirror): safe resource resolver for job inputs`
> **Revised after reviewing OllaBridge Local.** OllaBridge Local already holds the
> cloud device token and sits on the same PC, so it resolves `ollabridge-media://`
> refs (OL-2) and hands HomePilot a local temp file or inline bytes. HomePilot then
> never needs cloud credentials. HP-3 shrinks to: accept `params.image` as an
> artifact id, a local path inside the node's temp dir, or bounded base64, with
> the checks below applied to the bytes. The URL-fetching part is only a
> fallback for a standalone setup.

- Accept `resource_uri` (already forwarded by `mirror_proxy.create_job`) with
  scheme `ollabridge-media://<id>` (+ optional signed URL form).
- Resolve **only** against the configured OllaBridge base URL, with:
  - authentication;
  - `netguard.validate_outbound_url`;
  - no redirects off the allow-list;
  - a content-type allow-list (`image/jpeg|png|webp`);
  - a size cap and a sha256 check when provided.
- Hand the bytes to the handler as a temp artifact; delete them after the job.

### HP-4 · `feat(jobs): durable node jobs`
- Persist the job record (status, progress, output, error, timestamps) in SQLite
  next to the existing stores. Mark jobs that were in flight during a restart as
  `failed: node_restarted`, never "completed".
- Retention matches the artifact TTL. Needed because try-on renders can take minutes.

### HP-5 · `docs(mirror): external MCP applications`
- Document that SmartMirror (and any app) registers via `/v1/agentic/register/gateway`.
- Document the env flags, the allow-list semantics and the job contracts (§7).

### HP-6 · `feat(routines): tool action with argument template` (only if missing)
- Routines already call named Forge tools. Allow a routine to specify
  `{tool, arguments}` so "Outfit of the day at 07:30" is configuration:
  `hp.smartmirror.style_suggest {"prompt": "today, {weather}"}`.

### HP-7 · `test(mirror): contract + regression coverage`
- flag off → HomePilot unchanged (404 on the new ops);
- empty allow-list → denied;
- non-matching tool → denied;
- matching tool → executes (Forge mocked);
- `images.edit` lifecycle incl. cancel;
- resolver rejects foreign hosts, redirects, oversize and wrong types;
- restart marks in-flight jobs failed;
- legacy `/v1/chat/completions`, `/v1/models` and existing node ops unchanged.

---

## 5. SmartMirror workstream

### Backend

- **SM-1 Schema & infra**
  - Postgres + pgvector + MinIO become the default (the compose file already defines them).
  - New Alembic migration for:
    - `ai_metadata` / `user_metadata` / `effective_metadata` and confidence;
    - `ClassificationRun`;
    - `OutfitSet` and its members;
    - `ShoppingQuery` / `ShoppingCandidate`;
    - assets with a `cutout | thumbnail | mask` type.
- **SM-2 Media ingest**
  - `capture_ingest` / `wardrobe_ingest` accept an upload or an `ollabridge-media://` ref.
  - EXIF is stripped, the sha256 is used to dedupe, and files go to MinIO.
  - Body captures expire after their TTL.
- **SM-3 ML worker** (Redis queue, ONNX Runtime):
  - `birefnet-general-lite` cut-out;
  - **Marqo-FashionSigLIP** zero-shot + embeddings;
  - LAB k-means colour;
  - a confidence gate and a model registry (id, version, licence);
  - a benchmark job to measure speed on the owner's PC;
  - later: SegFormer-B2 (clothes worn on the body) and YOLOS-Fashionpedia (several items in one photo).
- **SM-4 MCP tools**
  - Add `wardrobe_ingest`, `wardrobe_review`, `wardrobe_confirm`, `set_create/get/list`,
    `gap_analyze`, `shop_suggest`, `shop_mark_purchased`, `capture_session_create/poll`.
  - Keep the `hp.smartmirror.*` namespace (HomePilot convention), so the allow-list
    is `HOMEPILOT_MIRROR_ALLOWED_TOOLS=hp.smartmirror.*`.
  - Update `packages/contracts/smartmirror-mcp-tools.json` (the BFF allow-list follows it).
- **SM-5 Stylist v2**
  - Uses the slot-based scorer from the design doc (weights in config).
  - Adds capsule and trip sets, and gap analysis.
  - **Grounded explanations:** the LLM receives only the chosen items and must
    cite their ids, following the MeetingSense pattern. Explanations never
    mention clothes the user does not own.
- **SM-6 Try-on provider**
  - `HomePilotEditProvider` creates an `images.edit` job on the **local** node-jobs
    endpoint (same PC, localhost-only by design).
  - It polls, stores the result as a `GeneratedPreview`, and labels it
    "AI style preview — not a fit guarantee".
- **SM-7 Shopping**
  - `ShoppingProvider` with `AmazonLinkOutProvider` (default, no API).
  - `AmazonCreatorsProvider` behind a flag, when the Associates account is eligible.
  - OAuth token cache, 1 TPS token bucket, text queries only, prices time-stamped.
- **SM-8 Privacy**
  - A retention sweeper, plus `DELETE /v1/profile/data` and the matching MCP tool.
  - An audit log that records events only, never content.

### Web (`apps/web`)

- **W-0** Pair like the 3D Avatar:
  - `OLLABRIDGE_BASE_URL` default `https://app.ollabridge.com`, `OLLABRIDGE_PAIRING_PATH` default `/pair`;
  - send `{code, label: "SmartMirror", client: {name: "smartmirror", version, platform}}`
    with `X-OllaBridge-Client: smartmirror`; accept both `{ok, token, device_id}`
    and the `pair-simple` shape `{status, device_token, device_id}`;
  - keep the token only in the sealed HttpOnly cookie; store `device_id`;
  - the pairing screen takes `ABCD-1234` codes: a letter/digit keypad that works with the
    D-pad and touch, plus "Pair from my phone" (the companion page enters the code);
  - show the OllaBridge error text ("Pairing code expired", "not linked to an account")
    instead of a generic failure; `GET /pair/info` shows whether pairing is open;
  - after pairing, list nodes (`/v1/mirror/nodes`) and models (`/v1/models`) to fill
    Settings → Connection: HomePilot node, stylist persona, online state;
  - "Forget this screen" clears the cookie. The owner can revoke the device from the OllaBridge dashboard.
- **W-7** Stylist chat on Plane A:
  - new BFF route `/api/stylist/chat` → `POST /v1/chat/completions`, model `persona:<id>`,
    headers `X-Client-Type: smart-mirror`, `X-Client-Capabilities`, `X-Include-Persona-Context: true`;
  - no local system prompt for remote personas; SmartMirror adds only a grounding
    block listing the owned items from `style_suggest`, so the persona never invents clothes;
  - streaming reply on screen and through `useSpeech`; the persona context sets the speaking rate;
  - retry `502/503/504` twice with backoff (the relayed chat path is the one that
    flakes, as the 3D Avatar measured); map timeouts to "Your home PC did not answer";
  - demo mode keeps the current deterministic stylist.
- **W-1** BFF `ollabridge` mode:
  - default `OLLABRIDGE_MCP_OPERATION=agentic.invoke`;
  - params `{tool, arguments}` to match HP-1;
  - map `tool_not_allowed` / `node_offline` to the existing error UI.
- **W-2** Add clothes:
  - QR-to-phone closet scan;
  - review queue with confidence-sorted chips (one press to correct);
  - AI / user metadata shown clearly.
- **W-3** Cross-device companion:
  - the phone uploads to OllaBridge media (the BFF `/api/media` already relays);
  - it calls `capture_session_*`, and the Echo polls and receives the photo;
  - BroadcastChannel stays as the simulator path.
- **W-4** Try-on: real job progress and preview from HomePilot; the demo overlay stays in demo mode.
- **W-5** Sets: "Plan my week" and "Pack for a trip" on the stylist; saved sets in Looks.
- **W-6** Shopping:
  - a "Complete the look" row under owned-clothes outfits, off by default in Settings;
  - QR to buy on the phone, and "I bought it".

### OllaBridge Cloud workstream (small, generic)

The relay, pairing, persona routing and mirror plane already exist. What remains:

- **Configuration:**
  - `HOMEPILOT_MIRROR_ENABLED=true` (the mirror plane 404s without it);
  - confirm the media cache TTL suits photo uploads;
  - no CORS change (the SmartMirror BFF calls server-to-server).
- **OB-1 · `feat(clients): recognise SmartMirror`:** add `"smartmirror": ClientDescriptor("SmartMirror", "ruslanmv")`
  to `KNOWN_CLIENTS` in `api/client_id.py`, plus a test, so the dashboard shows
  "SmartMirror" instead of "Web App (browser)". It's a one-line change on a list that needs a review.
- **OB-2 · `docs(clients)`:** add SmartMirror to the consumer table in the README and `docs/CLIENTS.md`,
  describing both planes (the 3D Avatar is only a Plane A example today).
- **OB-3 · `feat(mirror)`, optional (M5):** stream job progress (`/v1/mirror/jobs/{id}/events`)
  so long try-on renders do not need polling from a serverless function.

### OllaBridge Local workstream (`ruslanmv/ollabridge`, generic)

- **OL-1 · `feat(cloud): relay HomePilot mirror ops`** (**the M1b blocker**)
  - In `cloud/bridge_manager.py` `_handle_request`, handle `homepilot.mirror.manifest|rpc|job.create|job.get|job.cancel`
    by calling HomePilot `/v1/node/manifest`, `/v1/node/rpc`, `/v1/node/jobs[/{id}[/cancel]]` on
    `homepilot_base_url` (same PC; the node endpoints are localhost-only by design).
  - Port the mapping from `ollabridge-cloud/connector/bridge.py` so both bridges behave the same.
  - Only when HomePilot is enabled; otherwise return a structured `capability_unavailable`.
  - Keep a local allow-list of those five ops. Never log `params` (they may hold prompts or photos).
  - Advertise the ops in the bridge's capability/manifest report, so the cloud can show the node as "mirror-ready".
- **OL-2 · `feat(cloud): resolve cloud media for mirror jobs`**
  - When `job.create` carries `resource_uri: ollabridge-media://<id>`, download it from the paired cloud with
    the bridge's own token.
  - Check the content type (`image/jpeg|png|webp`), the size cap and the sha256.
  - Write it to HomePilot's node temp dir or pass it inline, then delete it after the job reaches a terminal state.
- **OL-3 · `feat(cloud): pass client context through the chat relay`**
  - Today only `X-Client-Type` is forwarded. Also forward `X-Client-Capabilities` and
    `X-Include-Persona-Context`, so HomePilot can shape replies for the mirror (short, speakable) the same way
    it does for the avatar.
- **OL-4 · tests**
  - Fake HomePilot: each mirror op maps to the right path; unknown op refused; HomePilot disabled → structured error.
  - Media: rejected when oversize or the wrong type; temp file removed.
  - `chat`, `models`, `media_fetch` and the image ops are unchanged.

Nothing fashion-specific enters OllaBridge (Cloud or Local).

---

## 6. Milestones and sequencing

```text
M1a Pair + persona chat (no HP/OB code) ──┐
M0 Foundations ──▶ M1b Remote tools ──────┴──▶ M2 Real try-on ──┐
       │                                                        ├──▶ M4 Sets + shopping ──▶ M5 Hardening
       └────────────▶ M3 Wardrobe AI ───────────────────────────┘
```

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M1a Pair + chat** | W-0, W-7, OB-1, OB-2, OL-3 (nice to have) | on Vercel, the simulator pairs with a real `ABCD-1234` code; the OllaBridge dashboard lists "SmartMirror"; "Alexa, ask the mirror what to wear" is answered by the owner's HomePilot stylist persona; the token never reaches the browser |
| **M0 Foundations** | SM-1, SM-8 skeleton, contract fixtures (§7), CI for both repos | migrations up/down green; contract fixtures validated in both CIs |
| **M1b Remote tools** | **OL-1**, OL-4, HP-1, HP-5, HP-7 (part), SM-4 (existing 5 tools), W-1, OllaBridge Cloud `HOMEPILOT_MIRROR_ENABLED=true` | the Vercel simulator in `ollabridge` mode lists the wardrobe and gets suggestions from a real home PC; a disallowed tool is rejected |
| **M2 Real try-on** | HP-2, HP-3, HP-4, **OL-2**, SM-2, SM-6, W-3, W-4 | phone photo → Echo → try-on rendered by ComfyUI through `images.edit`; survives a HomePilot restart without a false "completed" |
| **M3 Wardrobe AI** | SM-3, SM-4 (ingest/review/confirm), W-2 | ≥ 85 % category top-1 on a 200-item household set; ≤ 2 presses per correction; nothing leaves the PC |
| **M4 Sets + shopping** | SM-5, SM-7 (link-out, then Creators), W-5, W-6, HP-6 | saved sets; gap → QR link; optional Creators results that pair with owned items; morning outfit routine |
| **M5 Hardening** | idempotency keys, rate limits, retention, observability (trace ids Echo→OllaBridge→HomePilot→SmartMirror), device probe on Echo Show 21 | the §40 "definition of success" list from the architecture report passes end-to-end |

**Parallelism:**
- M1a can start now: it depends on nothing unmerged in HomePilot or OllaBridge.
- OL-1 and HP-1 are independent and can be built in parallel; M1b needs both.
- M3 (SmartMirror ML) runs in parallel with M1/M2 (HomePilot), because it only needs M0.
- HomePilot PRs HP-1 → HP-2 → HP-3 → HP-4 are small, and each can merge on its own.

---

## 7. Contracts (shared fixtures)

Stored in `SmartMirror/packages/contracts/v1/`; HomePilot's tests load a copy.

```jsonc
// agentic.invoke — request (OllaBridge → HomePilot node job)
{ "operation": "agentic.invoke",
  "params": { "tool": "hp.smartmirror.style_suggest",
              "arguments": { "prompt": "black mini skirt for dinner" } } }

// agentic.invoke — completed job output
{ "status": "completed",
  "output": { "tool": "hp.smartmirror.style_suggest",
              "result": { "request_id": "…", "outfits": [ … ] } } }

// images.edit — request
{ "operation": "images.edit",
  "resource_uri": "ollabridge-media://m_7f3a…",
  "params": { "prompt": "<structured edit spec>", "workflow": "edit" } }

// error envelope (all ops)
{ "status": "failed", "error": { "code": "TOOL_NOT_ALLOWED", "message": "…", "retryable": false } }
```

Error codes:

```text
TOOL_NOT_ALLOWED
NODE_OFFLINE
CAPABILITY_UNAVAILABLE
RESOURCE_REJECTED
IMAGE_EDIT_FAILED
JOB_TIMEOUT
JOB_CANCELLED
NODE_RESTARTED
```

---

## 8. Configuration

| Where | Variable | Default | Purpose |
|---|---|---|---|
| HomePilot | `HOMEPILOT_MIRROR_JOBS_ENABLED` | false | existing node jobs |
| HomePilot | `HOMEPILOT_MIRROR_MCP_ENABLED` | **false** | HP-1 |
| HomePilot | `HOMEPILOT_MIRROR_ALLOWED_TOOLS` | **empty (deny)** | e.g. `hp.smartmirror.*` |
| HomePilot | `HOMEPILOT_MIRROR_RESOURCE_MAX_MB` | 10 | HP-3 |
| SmartMirror | `SMARTMIRROR_IMAGE_PROVIDER` | `homepilot` | SM-6 |
| SmartMirror | `SMARTMIRROR_ML_DEVICE` | `cpu` | SM-3 (`cuda` when available) |
| SmartMirror | `SMARTMIRROR_SHOPPING` | `off` | SM-7 (`linkout`, `creators`) |
| SmartMirror | `AMAZON_CREATORS_CLIENT_ID/SECRET`, `AMAZON_PARTNER_TAG` | unset | SM-7, server-side only |
| SmartMirror web | `OLLABRIDGE_MCP_OPERATION` | `agentic.invoke` | W-1 |
| SmartMirror web | `OLLABRIDGE_BASE_URL` | `https://app.ollabridge.com` | W-0 (root, no `/v1`, same as the 3D Avatar) |
| SmartMirror web | `OLLABRIDGE_PAIRING_PATH` | `/pair` | W-0 |
| SmartMirror web | `OLLABRIDGE_STYLIST_MODEL` | unset (owner picks in Settings) | W-7, e.g. `persona:stylist` |
| SmartMirror web | `OLLABRIDGE_CLIENT_TYPE` | `smart-mirror` | W-7 `X-Client-Type` |
| OllaBridge Cloud | `HOMEPILOT_MIRROR_ENABLED` | false | must be **true** for Plane B (M1b) |
| OllaBridge Local | HomePilot link enabled + `homepilot_base_url` | `http://localhost:8000` | OL-1 target |
| OllaBridge Local | `OLLABRIDGE_MIRROR_MEDIA_MAX_MB` | 10 | OL-2 |

---

## 9. Testing strategy

- **Unit:** each HP operation, each SM tool, scorer, classifiers (with a fixed
  image fixture set), providers (Amazon mocked with recorded fixtures).
- **Contract:** the §7 fixtures are validated in HomePilot CI and SmartMirror CI.
- **Pairing / chat (M1a):** BFF tests against recorded OllaBridge responses
  (`/pair` ok, expired, not-linked; `/v1/models`; chat 200, 502-then-200, timeout);
  a Playwright check that no response body or client bundle contains the token;
  one manual run against `app.ollabridge.com` with a real HomePilot persona.
- **Integration:** docker-compose with HomePilot + SmartMirror + a stub OllaBridge;
  the Playwright simulator suites (already in place) run against `ollabridge` mode.
- **ML evaluation:** household labelled set (200 items); per-field accuracy and
  correction rate tracked per model version.
- **Device:** the Echo Show 21 probe checklist (`docs/device-testing/echo-show-21.md`).

---

## 10. Decisions needed from you

1. **Tool namespace:** keep `hp.smartmirror.*` (current code, HomePilot convention)
   rather than `smartmirror.*` from the report? *Recommended: keep.*
2. **Job durability (HP-4):** SQLite in HomePilot's data dir, acceptable?
3. **GPU at home:** is a GPU available for ComfyUI try-on and faster ML, or should
   M2/M3 plan for CPU-only first?
4. **Amazon:** start with link-out only, and add Creators only if an Associates
   account with ≥ 10 sales/30 days exists?
5. **Branching:** HomePilot PRs from `claude/meetingsense-grounded-chat`, or from
   HomePilot's default branch (smaller, independent PRs)? *Recommended: default
   branch, one PR per HP item.*
6. **Stylist persona:** create a "Stylist" persona in HomePilot by hand, or should SmartMirror
   ship a persona template (`integrations/homepilot/personas/stylist.json`) for the owner to import?
   *Recommended: ship the template; the persona stays the owner's data, not HomePilot code.*
7. **OllaBridge PRs:** OK to open OB-1/OB-2 on `ruslanmv/ollabridge-cloud` and OL-1…OL-4 on
   `ruslanmv/ollabridge`? (This session has read-only access to `ruslanmv/ollabridge`; pushing needs it attached with write access.)
8. **Start with M1a?** It is the fastest visible result (real pairing plus HomePilot chat on
   Vercel) and needs no HomePilot changes. *Recommended: yes.*
