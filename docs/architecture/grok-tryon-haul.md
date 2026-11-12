# Grok clothing swap and Amazon haul — mechanism

Status: **Client in this repo. Cloud adapter on ollabridge-cloud.**
Date: 11 November 2026.

This is the mechanism for swapping clothes, and for a short try-on haul of
Amazon candidates, when the only image path is OllaBridge Cloud.

## What was reviewed

| Source | What it shows |
|---|---|
| `ruslanmv/ollabridge-cloud` @ `claude/relaxed-dijkstra-rkcbl9` | Wave A job API: `POST /v1/images/edits`, `POST /v1/videos/generations`, `GET /v1/jobs/{id}`. Jobs route to a **paired GPU** only (tier 1). `ImageEditRequest` had `model`, `prompt`, one `image`, optional `mask` — **no** `references`, **no** Grok Imagine short-circuit. `XAI_API_KEY` already exists for chat (`xai-grok`). |
| Cloud follow-up `cursor/grok-imagine-tryon-7c54` | Additive: `references` + `duration` on the job sugar; `OLLABRIDGE_GROK_IMAGINE_ENABLED` (default off); `services/grok_imagine.py` maps `image`+`references` → xAI and short-circuits before device relay. Contract: `docs/contracts/grok-imagine-tryon.md` in that repo. |
| SmartMirror `OllaBridgeCloudEditProvider` | Same create/poll loop. Garment bytes and model `grok-imagine-image-2.0` only when `SMARTMIRROR_GROK_IMAGINE=true`. |
| SmartMirror shopping | Amazon **link-out** only (`https://www.amazon.<tld>/s?k=…`). No product image, no ASIN. |
| xAI Imagine docs, fetched 11 November 2026 | `grok-imagine-image-2.0` edits up to **5** images via `POST https://api.x.ai/v1/images/edits` (`images` array). `grok-imagine-video-1.5` takes `reference_images` via `POST https://api.x.ai/v1/videos/generations`. ~$0.04 / image; video 720p ~$0.14/s. |

### What the base cloud accepted (before the Grok adapter)

`ImageEditRequest` (required: `model`, `prompt`, `image`):

```text
image: { b64 | cache_url, content_type }   # one artifact
mask: optional
content_class: default "general"
```

`VideoGenerationRequest` (required: `model`): `prompt`, one `image`, `num_frames`, `fps`, `seed`, `content_class`. No `duration`, no second image.

Pydantic dropped unknown fields, so a body with `references` was accepted and ignored. A model id of `grok-imagine-image-2.0` still went to device routing and failed with `no_device_available` unless a node advertised that model. That is why both sides stay flag-gated.

## Why a text prompt cannot do this

Grok has no dedicated virtual-try-on model. A prompt that names "a black silk slip dress" asks the model to invent a dress. A swap needs the pixels.

Three gaps, in order:

1. **No garment image on the edit.** `garment_refs` were wardrobe ids. The cloud body carried only the person.
2. **No Amazon image.** Link-out is a search URL. There is nothing to composite. Scraping Amazon HTML is not the path.
3. **No haul.** One still, and no video route with a second image. Editing each result into the next one drifts the face.

Text-to-image (`/v1/images/generations`) cannot fill these gaps. It never sees the person.

## Ownership

Unchanged from the platform rule.

| Piece | Owner | Must not contain |
|---|---|---|
| Person, garment bytes, prompt, slot, haul sequence, disclaimer | **SmartMirror** | an xAI API key |
| Device token, media cache, job id, model adapter | **OllaBridge Cloud** | skirt, ASIN, haul, wardrobe |
| `grok-imagine-image-2.0` / `grok-imagine-video-1.5` | **xAI** | a SmartMirror account |

The xAI key lives only on the cloud (`XAI_API_KEY`). SmartMirror never calls `api.x.ai`.

## The mechanism: reference edit

Image 1 is the person. Images 2–5 are garments, in the order SmartMirror sends them. The cloud does not interpret them.

```text
mirror capture ──▶ SmartMirror
Amazon / wardrobe garment photo ──▶ SmartMirror
        │
        │  POST /v1/images/edits     (still, one outfit or one haul frame)
        │  POST /v1/videos/generations  (optional 6s clip of the chosen frame)
        ▼
OllaBridge Cloud
        │  SMARTMIRROR_GROK_IMAGINE + OLLABRIDGE_GROK_IMAGINE_ENABLED
        │  model grok-imagine-*  ──▶ xAI (not a paired Comfy node)
        │
        │  GET /v1/jobs/{id}     same poll SmartMirror already uses
        ▼
preview asset, labelled "AI style preview — not a fit guarantee"
```

### Still (`grok-imagine-image-2.0`)

SmartMirror sends:

```json
{
  "model": "grok-imagine-image-2.0",
  "prompt": "Image 1 is a real person. … image 2 (navy blazer). Replace only the jacket. …",
  "image": { "b64": "<person>", "content_type": "image/jpeg" },
  "references": [
    { "b64": "<garment>", "content_type": "image/jpeg" }
  ]
}
```

Built by `smartmirror.providers.vton.grok_edit.cloud_edit_body`. With no references the body stays today's shape: model `edit-default`, no `references` key.

The cloud maps that onto xAI, server-side, so the body photo is a data URI and never a public URL:

```json
{
  "model": "grok-imagine-image-2.0",
  "prompt": "<unchanged>",
  "images": [
    { "type": "image_url", "url": "data:image/jpeg;base64,…" },
    { "type": "image_url", "url": "data:image/jpeg;base64,…" }
  ]
}
```

Aspect ratio follows image 1 (the mirror photo) unless the cloud sets one. Cap is five sources, so four garments. Reject a sixth. Do not accept an arbitrary `http` URL in this body (that would be an SSRF in the cloud).

### Haul

A haul is **N independent stills**, each from the **original** capture plus **one** garment. `haul_edit_bodies` builds them. It refuses 0 frames and more than 8.

Do not chain edits (output of frame 1 as the person for frame 2). That is how the face drifts.

Default product cap for a shopping haul is 3 stills (about $0.12 of image calls, plus one input still each). Eight is the hard ceiling in the builder. A 6-second 720p clip is about $0.84, so it is opt-in on the frame the owner picks, not automatic for every candidate.

### Clip (`grok-imagine-video-1.5`)

`cloud_video_body` / `OllaBridgeCloudEditProvider.generate_clip`:

```json
{
  "model": "grok-imagine-video-1.5",
  "prompt": "The person in image 1 turns slightly in place and is now wearing the garment in image 2 …",
  "duration": 6,
  "image": { "b64": "<person>", "content_type": "image/jpeg" },
  "references": [ { "b64": "<garment>", "content_type": "image/jpeg" } ]
}
```

Duration is 2–10 seconds. The model allows 15; this client does not ask for that.

The cloud maps `image` + `references` to xAI `reference_images` and polls xAI's `request_id` **inside** the same `/v1/jobs/{id}` the stills use. SmartMirror's poll loop does not learn a second protocol.

`generate_clip` returns the bytes. The try-on job does not store video yet: previews are images, and `media.ingest` accepts JPEG/PNG/WebP only. A clip needs a later asset kind. The request shape is the part that has to stay stable.

## Prompt

`swap_prompt` is the swap. It is not a generic "make it fashionable" instruction.

- Image 1 stays: face, hair, skin tone, body, pose, camera, background.
- Image 2 (and 3, 4, 5) are the only new garments, named so the model can bind index to pixels.
- A haul frame names the slot (`jacket`, `top`, `dress`, …) and says to leave the other clothes alone.
- Pieces that have no photo are a separate sentence (`Also dress them in: …`), so a missing file does not get a fake image index.
- No extra people, no rendered text.

## Where the garment pixels come from

| Source | Ready? | How it enters the edit |
|---|---|---|
| Wardrobe item with `image_asset_id` | **Yes, when opted in** | `run_tryon_job` loads up to 4 photos only when the provider is `ollabridge-cloud` **and** `SMARTMIRROR_GROK_IMAGINE=true` (default false). A missing file or expired asset falls back to words. Any other storage error fails the job. HomePilot try-on stays text-only. With the flag off, the cloud body stays model `edit-default` and sends no garment bytes, so a cloud that has not enabled Grok keeps working. |
| Amazon link-out | **No pixels** | A search URL cannot be tried on. Leave it as the phone QR. |
| Amazon Creators API | **Not built** | When the Associates account qualifies, `GetItems` returns a catalogue image. SmartMirror downloads that image itself, stores it like any garment photo, and passes the bytes as a `HaulFrame`. The cloud never calls Amazon. |
| Owner-supplied product photo | **Fits the same frame** | A photo the owner already added (the "I bought this" / product-image path) is a garment asset. No new upload protocol. |

Amazon still receives text only. The body photo goes to xAI via the cloud, which D10 already allows when this provider is selected. That choice is `SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud`. It is off unless the owner sets it (the default provider is HomePilot, on the home PC).

## Cloud work (shipped on the ollabridge-cloud Grok branch)

Additive, flag default off:

1. `OLLABRIDGE_GROK_IMAGINE_ENABLED` (default **false**) and `XAI_API_KEY` on the cloud only.
2. Flag off: `POST /v1/images/edits` behaves as it did on `claude/relaxed-dijkstra-rkcbl9`. A Grok model id returns `CAPABILITY_UNAVAILABLE`.
3. Flag on: translate `image` + `references` to the xAI bodies above. Download the result into the existing artifact URL. Do not log the prompt or the bytes.
4. `POST /v1/videos/generations` accepts `references` and `duration`. Old clients that send only `model` and `prompt` stay valid.
5. No wardrobe, ASIN, or shopping type in the cloud schema.

## What this change does not do

- It does not call xAI from SmartMirror, the browser, or the Echo.
- It does not scrape Amazon.
- It does not show a video in the try-on job. The clip method is the contract; storage comes later.
- It does not turn link-out suggestions into a haul. A haul starts when something has a garment image.
