# Upgrade plan: HomePilot + SmartMirror

Status: **Plan (for review)** · Date: 24 September 2026
Baselines:
- HomePilot `claude/meetingsense-grounded-chat` @ `2168b22`
- SmartMirror `claude/upbeat-maxwell-sky163` @ `e45f553`

Goal: deliver the capabilities designed so far:

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

---

## 2. Capability → work matrix

| Capability | HomePilot | SmartMirror backend | SmartMirror web |
|---|---|---|---|
| Echo reaches SmartMirror remotely | **HP-1** `agentic.invoke` | SM-4 tool contract | W-1 align BFF operation |
| Try-on renders for real | **HP-2** `images.edit` job, **HP-4** durable jobs | SM-6 HomePilot try-on provider | W-4 real preview + progress |
| Photos travel phone → home safely | **HP-3** media resolver | SM-2 media ingest + storage | W-3 cross-device companion |
| Add clothes with AI classification | none | **SM-3** ML worker, SM-1 schema | W-2 add-clothes + review queue |
| Outfit sets + grounded stylist | none (LLM via existing chat) | **SM-5** scorer, sets, gap analysis, citations | W-5 sets UI |
| Shopping ("complete the look") | none | **SM-7** providers (link-out → Creators) | W-6 complete-the-look + opt-in |
| Outfit of the day (scheduled) | **HP-6** routine tool action (config) | tool `style_suggest` | display on home |
| Privacy (retention/deletion) | artifact TTL (exists) | **SM-8** retention + delete-all | Settings → delete data |

---

## 3. HomePilot workstream (generic PRs, all feature-flagged, default OFF)

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
- Document the env flags, the allow-list semantics and the job contracts (§6).

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

## 4. SmartMirror workstream

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

### OllaBridge

**No code.** Configuration only:
- `HOMEPILOT_MIRROR_ENABLED=true` on the cloud;
- confirm the media TTL suits photo uploads.

Any future improvements (job progress streaming, purpose-scoped media) stay generic.

---

## 5. Milestones and sequencing

```text
M0 Foundations ──▶ M1 Remote path ──▶ M2 Real try-on ──┐
       │                                                ├──▶ M4 Sets + shopping ──▶ M5 Hardening
       └────────────▶ M3 Wardrobe AI ───────────────────┘
```

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 Foundations** | SM-1, SM-8 skeleton, contract fixtures (§6), CI for both repos | migrations up/down green; contract fixtures validated in both CIs |
| **M1 Remote path** | HP-1, HP-5, HP-7 (part), SM-4 (existing 5 tools), W-1 | the Vercel simulator in `ollabridge` mode lists the wardrobe and gets suggestions from a real home PC; a disallowed tool is rejected |
| **M2 Real try-on** | HP-2, HP-3, HP-4, SM-2, SM-6, W-3, W-4 | phone photo → Echo → try-on rendered by ComfyUI through `images.edit`; survives a HomePilot restart without a false "completed" |
| **M3 Wardrobe AI** | SM-3, SM-4 (ingest/review/confirm), W-2 | ≥ 85 % category top-1 on a 200-item household set; ≤ 2 presses per correction; nothing leaves the PC |
| **M4 Sets + shopping** | SM-5, SM-7 (link-out, then Creators), W-5, W-6, HP-6 | saved sets; gap → QR link; optional Creators results that pair with owned items; morning outfit routine |
| **M5 Hardening** | idempotency keys, rate limits, retention, observability (trace ids Echo→OllaBridge→HomePilot→SmartMirror), device probe on Echo Show 21 | the §40 "definition of success" list from the architecture report passes end-to-end |

**Parallelism:**
- M3 (SmartMirror ML) runs in parallel with M1/M2 (HomePilot), because it only needs M0.
- HomePilot PRs HP-1 → HP-2 → HP-3 → HP-4 are small, and each can merge on its own.

---

## 6. Contracts (shared fixtures)

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

## 7. Configuration

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

---

## 8. Testing strategy

- **Unit:** each HP operation, each SM tool, scorer, classifiers (with a fixed
  image fixture set), providers (Amazon mocked with recorded fixtures).
- **Contract:** the §6 fixtures are validated in HomePilot CI and SmartMirror CI.
- **Integration:** docker-compose with HomePilot + SmartMirror + a stub OllaBridge;
  the Playwright simulator suites (already in place) run against `ollabridge` mode.
- **ML evaluation:** household labelled set (200 items); per-field accuracy and
  correction rate tracked per model version.
- **Device:** the Echo Show 21 probe checklist (`docs/device-testing/echo-show-21.md`).

---

## 9. Decisions needed from you

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
