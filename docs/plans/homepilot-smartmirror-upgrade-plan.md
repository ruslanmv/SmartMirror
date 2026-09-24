# Upgrade plan v2: SmartMirror × HomePilot × OllaBridge

Status: **Approved plan, ready to implement** · Date: 24 September 2026
Supersedes the v1 drafts of this file (see git history).

| Repository | Role | Baseline |
|---|---|---|
| `ruslanmv/SmartMirror` | the product: Echo Show UI, BFF, fashion backend | `claude/upbeat-maxwell-sky163` @ `6cc4a62` |
| `ruslanmv/HomePilot` | the owner's home AI: personas, compute, MCP | `master`; reviewed on `claude/meetingsense-grounded-chat` @ `2168b22` |
| `ruslanmv/ollabridge-cloud` | the cloud relay: pairing, accounts, chat and mirror planes | `master` @ `e4c3c0a` |
| `ruslanmv/ollabridge` | **OllaBridge Local**: the link between HomePilot and the cloud | `master` @ `b07dac0` |
| `ruslanmv/3D-Avatar-Chatbot` | reference client (same pairing + persona chat); **not changed** | `master` @ `1011e0c` |

---

## 1. Goal

Link the Smart Mirror to the owner's HomePilot **the same way the 3D Avatar
Chatbot is linked**: pair once with a code, then talk to a HomePilot persona.
On that link, deliver everything designed so far:

1. pairing and a stylist that speaks with the owner's own HomePilot persona;
2. wardrobe tools reachable from the Echo, anywhere;
3. real AI try-on rendered at home;
4. adding clothes with on-PC ML classification;
5. outfit sets and a grounded stylist;
6. shopping ("complete the look");
7. privacy and hardening.

---

## 2. Rules

### 2.1 Ownership

> **SmartMirror owns fashion. HomePilot supplies personas, compute and MCP.
> OllaBridge (Cloud + Local) supplies identity and connectivity.**
> No wardrobe, outfit or shopping concept enters HomePilot or OllaBridge.

### 2.2 Additive and non-destructive (HomePilot, OllaBridge Cloud, OllaBridge Local)

Every change to the three platform repos must satisfy **all** of these rules.
Each rule is checked in PR review.

| # | Rule | How it is checked |
|---|---|---|
| A1 | **New behaviour is behind a flag that defaults OFF.** With the flag off, the product behaves byte-for-byte as today. | a test runs with the flag off and asserts the legacy behaviour |
| A2 | **No existing endpoint, relay op, model id, header or response field is removed, renamed or changes meaning.** New response fields are optional and additive. | contract tests on existing routes stay green, unmodified |
| A3 | **New code goes in new modules.** Existing files only get registration lines (a router include, an `elif` branch, a list entry, a settings field). | reviewers check the diff stat: registration lines only in existing files |
| A4 | **Database changes add tables or nullable columns only.** No drops, renames, type changes or backfills of existing data. Every migration has a working downgrade. | migration up/down test |
| A5 | **Allow-lists only grow, and only by explicit entries.** The default is deny. | unit tests for deny-by-default |
| A6 | **No default changes.** Existing env vars keep their defaults; new env vars have safe defaults. | settings snapshot test |
| A7 | **Existing tests are not edited to make them pass.** New tests are added alongside. | the reviewer confirms no test file lines were modified or deleted (new test files only) |
| A8 | **Rollback = turn the flag off.** No data migration is needed to roll back. | rollback step in each PR description |
| A9 | **One concern per PR**, based on `master`, and independently mergeable. | PR checklist |
| A10 | **Nothing sensitive in logs.** Never log prompts, tool arguments, photos or tokens; log only names, ids, sizes, durations and status. | log-capture test |

SmartMirror is our product repo; it follows normal practice. Its own public
contracts (`packages/contracts`) are versioned and changed additively too.

---

## 3. System map

```text
 Echo Show 21 / browser         Vercel: apps/web (UI + BFF)          OllaBridge Cloud                     Owner's PC
┌────────────────────┐  HTTPS  ┌────────────────────────┐  HTTPS   ┌──────────────────────────┐  WSS   ┌───────────────────────────┐
│ /smartmirror UI    │───────▶│ /api/session/*          │────────▶│ /device/start|poll, /pair │◀──────│ OllaBridge Local          │
│ no token, ever     │ HttpOnly│ sealed cookie holds the │ Bearer   │ device token → owner      │ relay  │ (ruslanmv/ollabridge)     │
│                    │ cookie  │ device token            │ device   │                           │ dials  │   │                       │
│ Stylist voice/chat │───────▶│ /api/stylist/chat       │────────▶│ Plane A                   │  out   │   ├─ op "chat" ─────────▶ │ HomePilot
│                    │         │                         │          │ /v1/chat/completions      │───────▶│   │   persona "Stylist"   │  /v1/chat/completions
│ Wardrobe, try-on,  │───────▶│ /api/tools/[tool]       │────────▶│ Plane B                   │───────▶│   └─ op "homepilot.mirror.*"
│ sets, shopping     │         │ (contract allow-list)   │          │ /v1/mirror/nodes/{id}/…   │        │        (OL-1) ──────────▶ │  /v1/node/jobs
└────────────────────┘         └────────────────────────┘          └──────────────────────────┘        │                           │  agentic.invoke (HP-1)
                                                                                                        │                           │    └▶ SmartMirror MCP
                                                                                                        └───────────────────────────┘       (services/api)
```

**Two planes, one pairing:**

- **Plane A: chat.** OpenAI-compatible, `model: persona:<id>`. This is exactly
  what the 3D Avatar uses, and it **works today with no platform code**.
- **Plane B: mirror.** Owner-scoped jobs on the HomePilot node. It carries
  structured work: tools, try-on and media.

A paired device token resolves to the owner's account, so it authorises both
planes. It lives **only in the SmartMirror BFF** (a sealed HttpOnly cookie),
never in the browser, following the project rule.

---

## 4. Verified baseline and gaps

### 4.1 What already works (no change needed)

| Capability | Where |
|---|---|
| TV-style pairing: `POST /device/start` → `ABCD-1234` + `verification_url`; owner confirms; `POST /device/poll` → `device_token` | ollabridge-cloud `api/device_pair.py` |
| Code-entry pairing: `POST /pair {code, label, client}` → `{ok, token, device_id}` (the 3D Avatar path) | same file, `compat_pair` |
| Device token → owner identity (anonymous devices refused) | `core/user_context.resolve_device_token_user` |
| `persona:*` routing to HomePilot over the relay; `X-Client-Type` forwarded | cloud `ollama_proxy.py` → Local `_forward_chat` → HomePilot `openai_compat_endpoint.py` |
| Owner-scoped mirror plane with ownership gate, read-only RPC allow-list, job create/get/cancel | cloud `api/mirror.py` (flag `HOMEPILOT_MIRROR_ENABLED`, default off) |
| Media upload + cache | cloud `POST /v1/media/upload` |
| Node jobs with operation registry, localhost-only | HomePilot `node_jobs.py` |
| `edit_image` in both compute providers | HomePilot `compute/*` |
| Tool invocation via Context Forge | HomePilot `agentic/*` |
| Persona packages: `POST /persona/import` (`.hpersona` v2 zip with `persona_agent.json`, `tools.json`, `mcp_servers.json`, …); model ids `persona:<alias>--<short>` | HomePilot `personas/export_import.py`, `main.py` |

### 4.2 Gaps (each maps to a work item)

| Gap | Evidence | Item |
|---|---|---|
| OllaBridge Local answers `homepilot.mirror.*` with "Unsupported operation" | `cloud/bridge_manager.py` `_handle_request` handles only `chat`, `models`, `media_fetch`, `homepilot.image.*` | **OL-1** |
| No way to hand a cloud-uploaded photo to a HomePilot job | no resolver in Local or HomePilot | **OL-2**, HP-3 |
| No `agentic.invoke` / `images.edit` node jobs | `node_jobs.py` registers chat/images.generate/videos.generate only | **HP-1**, **HP-2** |
| Node jobs are in memory only | `_JOBS` dict | HP-4 |
| TV-flow devices are always named "My PC" | `device_poll` hard-codes `name="My PC"` | **OB-3** |
| "SmartMirror" is not a known client name | `api/client_id.py` `KNOWN_CLIENTS` | **OB-1** |
| `/v1/mirror/nodes` lists **every** device (phones, avatar, the mirror itself) with no capability hint | `list_nodes` | W-1 filters by probing the manifest; **OB-4** (optional field) |
| Relay-routed chat cannot stream (`501`) | cloud `ollama_proxy.py` | W-7 uses non-streaming |
| Mirror pairing screen takes 6 digits; the pair route sends field names OllaBridge ignores | `app/smartmirror/pairing`, `api/session/pair` | **W-0** |
| Stylist persona does not exist | none | **P-1** |

**Not needed** (considered and dropped): forwarding `X-Client-Capabilities` /
`X-Include-Persona-Context` through the relay. HomePilot reads only
`X-Client-Type` (and `X-Include-Media`), which already arrive. Persona context
(tone, voice) is an optional extra the 3D Avatar fetches separately; the mirror
does not need it for M1a, and it can be added later on the SmartMirror side only.

---

## 5. Decisions (resolved)

| # | Decision | Resolution |
|---|---|---|
| D1 | Link model | Follow the 3D Avatar pattern (pairing + persona chat) and add Plane B for tools and jobs. **Approved.** |
| D2 | Platform changes | **Additive and non-destructive only** (§2.2). **Approved.** |
| D3 | Stylist persona | SmartMirror ships a `.hpersona` template that the owner imports into HomePilot; the persona is owner data, not HomePilot code. **Approved.** |
| D4 | OllaBridge PRs | Open OB-1…OB-4 on `ollabridge-cloud` and OL-1…OL-3 on `ollabridge`. **Approved**; write access to both repos is now attached to this session. |
| D5 | First milestone | **M1a (pairing + stylist chat)**. **Approved.** |
| D6 | PR base branch | `master` in HomePilot, ollabridge-cloud and ollabridge; **one PR per item**. |
| D7 | Amazon | **Link-out first.** The Creators API comes later, only if the Associates account qualifies (10 sales / 30 days). |
| D8 | Tool namespace | Keep `hp.smartmirror.*`. |
| D9 | Durable jobs | Optional SQLite store in HomePilot, opt-in by flag (HP-4). |
| D10 | GPU | **Design for both.** Runs on CPU by default and auto-detects CUDA. Try-on falls back to OllaBridge Cloud `/v1/images/edits` when no local GPU is available. Still needed from the owner: whether a GPU exists at home; this does not block M1a/M1b. |

---

## 6. Work items by repository

Each item lists what changes, the flag, the additive guarantee, the tests and the rollback.

### 6.1 SmartMirror (product repo)

#### W-0 · Pairing that works like the 3D Avatar (M1a) — ✅ done
> Built as specified below. Also: a sealed `sm_pairing` cookie holds the secret
> `device_code`; demo mode confirms its own code so previews exercise the flow; the
> "type a code" keypad shows letters for the first four characters and digits after
> (OllaBridge codes are always `ABCD-1234`). Tests: `apps/web/test/pairing.test.ts`
> plus a Playwright run against a stub OllaBridge (token never reaches the page).
- **Primary flow: TV-style**, suited to a 10-foot screen with no typing:
  1. the BFF calls `POST /device/start`;
  2. the mirror shows the `ABCD-1234` code large, plus a QR code of `verification_url`;
  3. the owner confirms on a phone that is signed in to OllaBridge;
  4. the BFF polls `POST /device/poll` (sending the `client` block once OB-3 lands);
  5. the `device_token` is sealed into the HttpOnly cookie.
- **Secondary flow: code entry** (identical to the 3D Avatar):
  - `POST /pair {code, label: "SmartMirror", client: {name: "smartmirror", version, platform}}`;
  - a letter-and-digit keypad that works with the D-pad and touch, for dashboard-generated codes.
- The BFF accepts both response shapes (`{ok, token, device_id}` and `{status, device_token, device_id}`).
- OllaBridge error texts are shown as-is ("Pairing code expired", "not linked to an account").
- Settings → Connection shows the paired account, HomePilot node, stylist persona and online state.
  "Forget this screen" clears the cookie; the owner revokes the device in the OllaBridge dashboard.
- Env defaults: `OLLABRIDGE_BASE_URL=https://app.ollabridge.com`, `OLLABRIDGE_PAIRING_FLOW=device|code`.
- **Tests:** recorded-response BFF tests (start, pending, approved, expired; `/pair` ok, expired, not-linked);
  Playwright: pair in the simulator; assert no token in any response body, the HTML or JS bundles.

#### W-7 · Stylist chat on Plane A (M1a) — ✅ done
> Built as specified. The persona answer sits above the outfits; when the wardrobe tools
> are not connected yet (before M1b) the persona still answers, marked as general advice.
> Settings → Stylist chooses the persona and reading aloud. Tests: `apps/web/test/stylist.test.ts`.
- New BFF route `/api/stylist/chat` → `POST /v1/chat/completions`, `model: persona:<stylist>`,
  `X-Client-Type: smart-mirror`, **non-streaming** (relay streaming returns 501).
- Persona discovery: `GET /v1/models`, pick the id whose alias starts with `stylist`; the owner can change it in Settings.
- No local system prompt for remote personas (3D Avatar rule). SmartMirror adds a **grounding block**
  only when the tools are available (M1b+): the owned items chosen by `style_suggest`, so the persona never invents clothes.
- Retry `502/503/504` twice with backoff; map a timeout to "Your home PC did not answer".
- Reply shown on screen and spoken through `useSpeech`; Alexa `StyleIntent` uses the same route.
- Demo mode keeps the current deterministic stylist.

#### P-1 · Stylist persona template (M1a) — ✅ done
- Source `integrations/homepilot/personas/stylist/` in the `.hpersona` v2 layout:
  - `manifest.json`;
  - `blueprint/persona_agent.json`: label "Stylist", ≤ 3 short speakable sentences,
    the "Owned items" grounding rule, no body comments;
  - `blueprint/persona_appearance.json` and `preview/card.json`.
- Built package committed as `integrations/homepilot/personas/stylist.hpersona`
  (`make persona` / `pnpm persona:build`; deterministic, so CI checks it is not stale).
- **Found while building:**
  - an imported persona is **not published**; the owner switches on **Publish as API Model**
    with alias `stylist` (`POST /projects/{id}/shared-api`), otherwise it is invisible in `/v1/models`;
  - HomePilot **pins declared tools on import**, so the template declares **no tools** until M1b
    (a later template version adds the SmartMirror MCP server).
- **Tests:** `tests/contracts/test_stylist_persona.py`, including a round-trip through
  HomePilot's real `preview_persona_package` / `import_persona_package` (skipped without a
  HomePilot checkout; `HOMEPILOT_SRC`).

#### W-1 · BFF `ollabridge` mode on Plane B (M1b)
- Default `OLLABRIDGE_MCP_OPERATION=agentic.invoke`, params `{tool, arguments}` (HP-1 contract).
- Node selection: the online devices from `/v1/mirror/nodes`; probe `…/manifest` and keep the one advertising
  `agentic.invoke`. Use OB-4's `capabilities` field when present. Cache the chosen `node_id` in the session.
- Map `TOOL_NOT_ALLOWED`, `NODE_OFFLINE` and `CAPABILITY_UNAVAILABLE` to the existing error UI.

#### W-2 … W-6 (unchanged from v1)
- **W-2** Add clothes: QR-to-phone closet scan, review queue with confidence chips, AI vs user metadata.
- **W-3** Cross-device companion: the phone uploads to `/v1/media/upload`; `capture_session_*` tools; the Echo polls.
- **W-4** Try-on: real job progress and preview from HomePilot; the demo overlay stays for demo mode.
- **W-5** Sets: "Plan my week", "Pack for a trip"; saved sets in Looks.
- **W-6** Shopping: a "Complete the look" row (off by default), QR to buy, "I bought it".

#### Backend SM-1 … SM-8 (unchanged from v1)
- **SM-1:** Postgres + pgvector + MinIO; new tables for metadata, classification runs, sets and shopping.
- **SM-2:** media ingest (EXIF strip, sha256 dedupe, TTL for body photos).
- **SM-3:** ML worker (ONNX: BiRefNet-lite cut-out, Marqo-FashionSigLIP, LAB colour; CPU by default, CUDA auto).
- **SM-4:** MCP tools (`wardrobe_ingest/review/confirm`, `set_*`, `gap_analyze`, `shop_*`, `capture_session_*`) and a contracts update.
- **SM-5:** stylist v2 with sets and grounded citations (MeetingSense pattern).
- **SM-6:** try-on provider: a local HomePilot `images.edit` job, falling back to OllaBridge Cloud `/v1/images/edits` (D10).
- **SM-7:** shopping: `AmazonLinkOutProvider` (default); `AmazonCreatorsProvider` behind a flag.
- **SM-8:** privacy: a retention sweeper, delete-all, and an audit log of events only.

### 6.2 OllaBridge Local (`ruslanmv/ollabridge`)

#### OL-1 · `feat(cloud): relay HomePilot mirror ops` (M1b, the transport blocker)
- **New module** `cloud/homepilot_mirror_relay.py`, following the existing `homepilot_image_relay.py`.
  - It maps `homepilot.mirror.manifest|rpc|job.create|job.get|job.cancel` to HomePilot
    `/v1/node/manifest`, `/v1/node/rpc` and `/v1/node/jobs[/{id}[/cancel]]` on `HOMEPILOT_BASE_URL` (same PC).
  - It sends `HOMEPILOT_API_KEY` when set.
  - The mapping is ported from `ollabridge-cloud/connector/bridge.py` so both bridges behave the same.
- **Registration only** in `bridge_manager.py`:
  - an `elif op in MIRROR_OPS` branch;
  - appending `"homepilot.mirror"` to the hello `capabilities` when the flag is on.
- Flag `HOMEPILOT_MIRROR_RELAY_ENABLED` (**default false**; also requires `HOMEPILOT_ENABLED`).
  With the flag off, the op still returns today's "Unsupported operation" (A1).
- A fixed allow-list of the five ops (A5); never log `params` (A10).
- **Rollback:** flag off.

#### OL-2 · `feat(cloud): resolve cloud media for mirror jobs` (M2)
- New module `cloud/mirror_media.py`.
  - On `job.create` with `resource_uri: ollabridge-media://<id>`, download from the paired cloud using the bridge's own token.
  - Enforce `image/jpeg|png|webp`, `OLLABRIDGE_MIRROR_MEDIA_MAX_MB` (default 10) and the sha256 when given.
  - Pass the bytes to HomePilot inline (`params.image_b64`) or as a node temp artifact (HP-3); delete the temp copy when the job ends.
- Same flag as OL-1 plus `HOMEPILOT_MIRROR_MEDIA_ENABLED` (default false).
- HomePilot never holds cloud credentials.

#### OL-3 · `test+docs(cloud): mirror relay`
- New test files `tests/test_homepilot_mirror_relay.py` and `tests/test_mirror_media.py` (A7), covering:
  - with a fake HomePilot, each op maps to the right path;
  - an unknown op is refused;
  - flag off → legacy "Unsupported operation";
  - HomePilot disabled → `capability_unavailable`;
  - media: oversize or wrong type is rejected, and the temp file is removed;
  - `chat`, `models`, `media_fetch` and `homepilot.image.*` are unchanged (the existing tests stay green, unmodified).
- Docs: a "HomePilot Cloud Mirror" section in the README / `docs/` with the flags and a diagram.

### 6.3 OllaBridge Cloud (`ruslanmv/ollabridge-cloud`)

- **Configuration only (no code):**
  - `HOMEPILOT_MIRROR_ENABLED=true` for M1b;
  - confirm the media cache TTL fits photo uploads;
  - no CORS change (the BFF calls server-to-server).
- **OB-1 · `feat(clients): recognise SmartMirror`** (M1a): add `"smartmirror": ClientDescriptor("SmartMirror", "ruslanmv")`
  to `KNOWN_CLIENTS` and add a new test. The list only grows (A5).
- **OB-2 · `docs(clients): SmartMirror consumer`** (M1a): README consumer table plus `docs/CLIENTS.md`, showing both planes.
- **OB-3 · `feat(pairing): optional client block on /device/poll`** (M1a)
  - `DevicePollRequest.client: ClientBlock | None = None`.
  - When present, the created device is named via `resolve_client`; when absent it is still **"My PC"** (A1/A2).
  - No DB change (the existing `name`, `platform` and `client_version` columns are used).
  - Test: with and without the block.
- **OB-4 · `feat(mirror): optional capabilities on node list`** (M1b, optional)
  - `/v1/mirror/nodes` items gain an optional `capabilities: list[str]`, taken from the relay hello already held by the hub.
  - Existing fields are unchanged (A2), and the response is unchanged when the hub has no data.
- Nothing fashion-specific; no change to Plane A, `/pair`, federation or providers.

### 6.4 HomePilot (`ruslanmv/HomePilot`)

#### HP-1 · `feat(mirror): allow-listed agentic.invoke node job` (M1b)
- New module `node_ops_agentic.py`, registered with one line:
  `register_operation("agentic.invoke", "mcp:invoke", handler)`.
- Params `{tool, arguments, timeout_s?}`. Flags `HOMEPILOT_MIRROR_MCP_ENABLED` (**false**) and
  `HOMEPILOT_MIRROR_ALLOWED_TOOLS` (**empty = deny**, `fnmatch` globs, e.g. `hp.smartmirror.*`).
- Executes through the existing `ContextForgeClient.invoke_tool` (`asyncio.run` in the job thread); honours cancel.
- Output `{tool, result}`. Logs only the tool name, duration and status (A10).
- The manifest lists `agentic.invoke` only when the flag is on.

#### HP-2 · `feat(compute): images.edit node job` (M2)
- New module `node_ops_images_edit.py` → `ComputeRouter.edit_image`. Outputs are saved as TTL `node_artifacts`.
- Gated by `HOMEPILOT_MIRROR_IMAGE_EDIT_ENABLED` (false).
- **Additive fix of the manifest mismatch:** registering the handler makes the existing `images.edit`
  advertisement truthful. The manifest derivation logic is **not** changed (A2).

#### HP-3 · `feat(mirror): job image inputs` (M2)
- `images.edit` accepts `params.image` as an artifact id, a path inside the node temp dir, or bounded base64 (`HOMEPILOT_MIRROR_RESOURCE_MAX_MB`, default 10).
- Content-type and size checks are applied to the bytes. There is no outbound fetching in HomePilot (OL-2 resolves cloud media).

#### HP-4 · `feat(jobs): optional durable node-job store` (M2)
- New module `node_jobs_store.py` with a **new** SQLite file and table (A4).
- `HOMEPILOT_NODE_JOBS_STORE=memory|sqlite`, **default `memory`** (today's behaviour).
- With `sqlite`, jobs in flight during a restart become `failed: NODE_RESTARTED`.

#### HP-5 · `docs(mirror): external MCP applications` (M1b)
- How an app registers via `/v1/agentic/register/gateway`; the flags; the job contracts (§8); importing a `.hpersona` that declares an MCP server.

#### HP-6 · `feat(routines): tool action with argument template` (M4, only if missing)
- A new action type; existing action types unchanged. Enables a scheduled "Outfit of the day".

#### HP-7 · `test(mirror): contract + regression` (with each PR)
- New test files only (A7), covering:
  - flag off → new ops 404/refused and the manifest unchanged;
  - empty allow-list → denied; non-matching → denied; matching → executes (Forge mocked);
  - the `images.edit` lifecycle including cancel;
  - input rejection;
  - restart handling (sqlite store);
  - legacy `/v1/chat/completions`, `/v1/models`, persona import and the existing node ops unchanged.

---

## 7. Milestones and PR order

```text
M1a Pair + persona chat ──────────────────────────────┐
M0 Foundations ──▶ M1b Remote tools ──▶ M2 Real try-on ──┴──▶ M4 Sets + shopping ──▶ M5 Hardening
       └──────────▶ M3 Wardrobe AI ─────────────────────────┘
```

| Milestone | PRs (in order) | Exit criteria |
|---|---|---|
| **M1a Pair + chat** *(start here)* | OB-1 → OB-3 → OB-2 (cloud); P-1, W-0, W-7 (SmartMirror) | On Vercel, the Echo simulator pairs via the TV flow. The OllaBridge dashboard shows **"SmartMirror"** (not "My PC"). "What should I wear tonight?" is answered on screen and aloud by the owner's HomePilot **Stylist** persona. No token reaches the browser. The 3D Avatar still pairs and chats unchanged. |
| **M0 Foundations** | SM-1, SM-8 skeleton, contract fixtures (§8), CI in all repos | migrations up/down green; fixtures validated in SmartMirror, HomePilot and OllaBridge Local CI |
| **M1b Remote tools** | OL-1 + OL-3 (Local), HP-1 + HP-5 + HP-7 (HomePilot), OB-4 (optional), SM-4 (existing 5 tools), W-1; cloud `HOMEPILOT_MIRROR_ENABLED=true` | the wardrobe lists and suggestions come from the real home PC; a disallowed tool is rejected; the stylist answer cites owned items; with all flags off, every repo behaves as before |
| **M2 Real try-on** | HP-2, HP-3, HP-4, OL-2, SM-2, SM-6, W-3, W-4 | phone photo → Echo → try-on rendered at home (or the cloud fallback); a HomePilot restart never shows a false "completed" |
| **M3 Wardrobe AI** | SM-3, SM-4 (ingest/review/confirm), W-2 | ≥ 85 % category top-1 on a 200-item household set; ≤ 2 presses per correction; photos never leave the PC |
| **M4 Sets + shopping** | SM-5, SM-7 (link-out), W-5, W-6, HP-6 | saved sets; gap → QR link; morning outfit routine; Creators only after D7 is met |
| **M5 Hardening** | idempotency keys, rate limits, retention, trace ids across all hops, Echo Show 21 device probe | the architecture report's "definition of success" passes end-to-end |

**Parallelism:**
- M1a needs nothing unmerged elsewhere.
- OL-1 and HP-1 are independent, so M1b's platform PRs can be reviewed in parallel.
- M3 runs alongside M1b/M2.

**First batch (M1a), concretely:**
1. **ollabridge-cloud**, three PRs:
   - OB-1: one list entry plus a test;
   - OB-3: an optional request field plus a test;
   - OB-2: docs.
2. **SmartMirror**, three commits on this branch:
   - P-1: the persona template and build script;
   - W-0: TV-flow pairing, code-entry fallback and Settings → Connection;
   - W-7: stylist chat route, UI and voice.

---

## 8. Contracts (shared fixtures, `packages/contracts/v1/`)

```jsonc
// Plane A — stylist chat (BFF → OllaBridge Cloud)
POST /v1/chat/completions
Headers: Authorization: Bearer <device token>   // server-side only
         X-Client-Type: smart-mirror
{ "model": "persona:stylist--3f2a", "stream": false,
  "messages": [ { "role": "system", "content": "<grounding block: owned items, M1b+>" },
                { "role": "user", "content": "What should I wear to dinner?" } ] }

// Pairing — TV flow
POST /device/start                       → { "user_code": "ABCD-1234", "device_code": "…", "verification_url": "…", "expires_in": 600 }
POST /device/poll { "device_code": "…",
                    "client": { "name": "smartmirror", "version": "0.3.0", "platform": "android" } }   // client: OB-3, optional
                                         → { "status": "approved", "device_id": "…", "device_token": "…" }

// Plane B — agentic.invoke (BFF → Cloud → Local → HomePilot node job)
POST /v1/mirror/nodes/{node_id}/jobs
{ "operation": "agentic.invoke",
  "params": { "tool": "hp.smartmirror.style_suggest", "arguments": { "prompt": "black mini skirt for dinner" } } }
// completed
{ "status": "completed", "output": { "tool": "hp.smartmirror.style_suggest", "result": { "outfits": [ … ] } } }

// Plane B — images.edit
{ "operation": "images.edit", "resource_uri": "ollabridge-media://m_7f3a…",
  "params": { "prompt": "<structured edit spec>", "workflow": "edit" } }

// Error envelope (all ops)
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

## 9. Configuration (every new platform flag defaults to OFF)

| Repo | Variable | Default | Item |
|---|---|---|---|
| ollabridge-cloud | `HOMEPILOT_MIRROR_ENABLED` (exists) | false | set **true** for M1b |
| ollabridge (Local) | `HOMEPILOT_ENABLED`, `HOMEPILOT_BASE_URL`, `HOMEPILOT_API_KEY` (exist) | false, `http://localhost:8000`, "" | M1a chat already uses these |
| ollabridge (Local) | `HOMEPILOT_MIRROR_RELAY_ENABLED` | **false** | OL-1 |
| ollabridge (Local) | `HOMEPILOT_MIRROR_MEDIA_ENABLED`, `OLLABRIDGE_MIRROR_MEDIA_MAX_MB` | **false**, 10 | OL-2 |
| HomePilot | `HOMEPILOT_MIRROR_JOBS_ENABLED` (exists) | false | set **true** for M1b |
| HomePilot | `HOMEPILOT_MIRROR_MCP_ENABLED`, `HOMEPILOT_MIRROR_ALLOWED_TOOLS` | **false**, **empty** | HP-1 (`hp.smartmirror.*`) |
| HomePilot | `HOMEPILOT_MIRROR_IMAGE_EDIT_ENABLED`, `HOMEPILOT_MIRROR_RESOURCE_MAX_MB` | **false**, 10 | HP-2/HP-3 |
| HomePilot | `HOMEPILOT_NODE_JOBS_STORE` | **memory** | HP-4 (`sqlite`) |
| SmartMirror web | `SMARTMIRROR_BACKEND` (exists) | auto (`demo` when nothing is configured) | `ollabridge` for M1a+ |
| SmartMirror web | `OLLABRIDGE_BASE_URL` | `https://app.ollabridge.com` | W-0 |
| SmartMirror web | `OLLABRIDGE_PAIRING_FLOW` | `device` | W-0 (`code` = 3D Avatar style) |
| SmartMirror web | `OLLABRIDGE_STYLIST_MODEL` | auto (alias `stylist`) | W-7 |
| SmartMirror web | `OLLABRIDGE_MCP_OPERATION` | `agentic.invoke` | W-1 |
| SmartMirror web | `SMARTMIRROR_SESSION_SECRET` (exists) | required in prod | seals the token |
| SmartMirror | `SMARTMIRROR_IMAGE_PROVIDER` | `homepilot` (falls back to `ollabridge-cloud`) | SM-6 |
| SmartMirror | `SMARTMIRROR_ML_DEVICE` | `auto` (CPU, CUDA if present) | SM-3 |
| SmartMirror | `SMARTMIRROR_SHOPPING` | `off` (`linkout`, `creators`) | SM-7 |

---

## 10. Testing

- **Legacy-unchanged suites (the additive proof).** In each platform repo, the **existing** test suite runs
  unmodified and green, with all new flags off **and** with them on. Also a scripted **3D Avatar smoke test**:
  `/pair`, `/v1/models`, `persona:*` chat. It proves the reference client is untouched.
- **Unit:** each new op, relay branch, tool, the scorer, classifiers (fixed image fixtures), and providers (Amazon recorded).
- **Contract:** the §8 fixtures are validated in the SmartMirror, HomePilot and OllaBridge Local CIs.
- **Integration:**
  - docker-compose with HomePilot + OllaBridge Local + a stub OllaBridge Cloud + the SmartMirror API;
  - the existing Playwright simulator suites run in `ollabridge` mode;
  - one manual run against `app.ollabridge.com` per milestone.
- **Security:**
  - token never in browser output;
  - cross-owner node access returns 404 (existing cloud gate);
  - a disallowed tool is rejected at HomePilot;
  - an oversize or wrong-type image is rejected at Local.
- **ML evaluation:** the household set (200 items), per-field accuracy and correction rate per model version.
- **Device:** the Echo Show 21 probe checklist.

---

## 11. Rollout and rollback

| Step | Action | Rollback |
|---|---|---|
| 1 | Merge OB-1/OB-2/OB-3 (inert until used) | revert PR; no data impact |
| 2 | Import `stylist.hpersona` into HomePilot and publish it with alias `stylist`; set SmartMirror `SMARTMIRROR_BACKEND=ollabridge` on a Vercel **preview** | delete persona; switch back to `demo` |
| 3 | Pair the simulator; run the M1a exit checks; promote to production | "Forget this screen", revoke the device in the dashboard |
| 4 | Merge OL-1/HP-1 (flags off); enable `HOMEPILOT_MIRROR_ENABLED`, `HOMEPILOT_MIRROR_RELAY_ENABLED`, `HOMEPILOT_MIRROR_JOBS_ENABLED`, `HOMEPILOT_MIRROR_MCP_ENABLED` with the allow-list `hp.smartmirror.*` on the owner's PC | turn the flags off; everything returns to today's behaviour |
| 5 | M2+ flags one at a time (`…IMAGE_EDIT…`, `…MEDIA…`, `NODE_JOBS_STORE=sqlite`) | flag off; the sqlite file can be deleted |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| A device token is account-wide in the cloud | kept server-side only; HomePilot's tool allow-list limits what Plane B can run; the owner can revoke per device; optional future OB item: device-scoped permissions (additive) |
| Relay chat is slow or flaky (measured by the 3D Avatar) | non-streaming with retry and backoff; clear "home PC did not answer" message; demo fallback |
| Serverless time limits vs long try-on jobs | job id + UI polling (already the BFF design); HP-4 durable store |
| Persona invents clothes the user doesn't own | grounding block + the persona rule + citation check in SM-5 |
| Platform regression | §2.2 rules, legacy-unchanged suites, 3D Avatar smoke test, flags default off |
| No GPU at home | CPU ML by default; try-on falls back to OllaBridge Cloud `/v1/images/edits` |

---

## 13. Still open

- **GPU at home?** Only affects M2/M3 performance defaults, not the design or M1a/M1b.
