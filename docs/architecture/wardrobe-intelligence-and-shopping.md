# Wardrobe intelligence, outfit sets and shopping — design

Status: **Proposed (design only)** · Date: 24 September 2026
Scope: how clothes get into the wardrobe, which lightweight ML models classify
them and where they run, how outfit *sets* are built, and how an Amazon
integration can recommend items to buy. Fits the platform contract in the
executive architecture: **SmartMirror owns wardrobe data and logic, HomePilot
supplies compute, OllaBridge supplies connectivity.**

---

## 1. Goals and principles

1. **Adding a garment takes seconds and never requires typing.** Photo in,
   metadata out; the user confirms or corrects with a few D-pad presses.
2. **AI proposes, the user decides.** Every garment stores `ai_metadata`,
   `user_metadata` and `effective_metadata` (user overrides AI).
3. **Photos stay home.** Garment and body photos are processed on the owner's
   HomePilot PC. Nothing personal is sent to Amazon; only text queries are.
4. **One embedding space for everything.** The same fashion embedding model
   classifies garments, powers wardrobe search, scores outfit compatibility and
   ranks shopping results, so "pairs with 5 things you own" is computable.
5. **Lightweight and replaceable.** Models are ONNX, CPU-capable and behind
   provider interfaces with `model_id` + `model_version` recorded per result.

---

## 2. Ways to add clothes

| Path | Best for | Device | Notes |
|---|---|---|---|
| **Phone snap (primary)** | one garment on a bed, hanger or floor | companion phone via QR | best camera, easy framing; works when the Echo camera is blocked |
| **Closet scan (batch)** | many items at once | phone | take 10–30 photos in a row; processed as a queue; review later on the Echo |
| **Mirror snap** | an item you are wearing | Echo / laptop live mirror | person parsing crops each worn garment |
| **"I bought this"** | new purchases | Echo / phone from a shopping card | pre-filled from the product (image, category, colour, brand); no photo needed |
| **Product link / receipt** | online purchases elsewhere | phone | paste a URL; fetch product image + title server-side (allow-listed hosts only) |
| **Manual** | edge cases | any | today's chip form (category, colour, material) |

### Review card (Echo, D-pad first)

```text
┌───────────────────────────────────────────────┐
│  [cut-out photo]   Black leather mini skirt   │
│                    ● skirt · mini · leather   │
│                    ● black · solid            │
│                    ● evening · party · A/W    │
│   Is this right?   [ Save ]  [ Fix ]  [ Skip ] │
└───────────────────────────────────────────────┘
```

*Fix* opens chip rows pre-sorted by model confidence (top-3 first), so a
correction is usually **one arrow + OK**. Low-confidence fields show an amber
dot; the queue only stops on items that need a decision.

---

## 3. Ingestion pipeline

```text
photo ─▶ validate (type, size, EXIF strip, sha256 dedupe)
      ─▶ S1 background removal / garment cut-out
      ─▶ S2 garment detection or person parsing (only if needed)
      ─▶ S3 fashion embedding  ──┬─▶ zero-shot attributes (category, pattern, material, style, season, occasion)
      │                          └─▶ pgvector (search · compatibility · shopping)
      ─▶ S4 colour extraction (deterministic, LAB k-means)
      ─▶ S5 optional VLM description (only for low-confidence items)
      ─▶ confidence gate ─▶ auto-accept  |  review queue
      ─▶ WardrobeItem + GarmentAssets(original, cutout, thumb) + GarmentEmbedding + ClassificationRun
```

Runs in the **SmartMirror worker** (Redis queue) on the home PC; each stage is a
provider with its own model id/version so it can be swapped or re-run.

---

## 4. Model research and selection

All candidates below are open-weight, run on CPU via ONNX Runtime, and need no
training for day one.

| Stage | Recommended | Size / licence | Why | Lighter alternative |
|---|---|---|---|---|
| **S1 cut-out** | rembg `birefnet-general-lite` | small ONNX | clean product cut-outs, better fabric edges than U²-Net | `u2netp` (fastest), `isnet-general-use` |
| **S2 worn garments** | `mattmdjaga/segformer_b2_clothes` | 27.4 M params, ONNX | 18 human-parsing classes (upper, skirt, pants, dress, shoes, bag…), ~69 % mIoU; also gives masks for try-on | rembg `u2net_cloth_seg` |
| **S2 multi-item photos** | `valentinafeve/yolos-fashionpedia` | YOLOS-small | Fashionpedia detection (46 k images, 342 k boxes), finds several garments in one photo | skip; ask for one item per photo |
| **S3 embedding + zero-shot** | **`Marqo/marqo-fashionSigLIP`** | ~0.2 B params, Apache-2.0 | fashion-tuned SigLIP; trained on categories, colours, materials, styles; up to +57 % retrieval vs FashionCLIP; open_clip, transformers and transformers.js | `patrickjohncyh/fashion-clip` 2.0 (ViT-B/32, MIT, ~0.15 B; weighted F1 0.83 FMNIST / 0.73 KAGL / 0.62 DeepFashion) |
| **S4 colour** | k-means in CIELAB on cut-out pixels | no model | exact hex + named colour; more reliable than zero-shot for colour | — |
| **S5 description** | HomePilot vision LLM (local first) | via HomePilot compute | free-text detail (brand print, trims) only when needed | skip |

### Zero-shot classification with our taxonomy

No training set is needed: encode prompts once per label and compare with the
image embedding.

```text
category    "a photo of a {skirt|dress|blazer|jeans|sneakers|...}"
length      "a {mini|midi|maxi} skirt"
pattern     "a {solid|striped|floral|checked|polka dot|animal print} garment"
material    "a garment made of {denim|leather|silk|wool|cotton|linen|knit|satin}"
style       "{elegant|casual|sporty|minimal|bohemian|edgy} fashion"
season      "clothing for {summer|winter|spring and autumn}"
occasion    "an outfit for {office|evening|party|beach|sport|travel}"
```

Hierarchical: predict **category** first, then only ask the attribute questions
that make sense for it (no "length" for sneakers).

### Getting better with use (personalisation, no retraining)

- Every confirmed or corrected item becomes a **labelled example in the user's own
  embedding space**. Classify new items with a blend of zero-shot score and
  k-nearest-neighbour over the user's confirmed items. This quickly learns
  "my navy is this navy" and each wardrobe's own quirks.
- Later, optionally, a tiny **linear probe** per attribute (logistic regression on
  embeddings, milliseconds to train) once a profile has ~50 confirmed items.
- Track **correction rate per field** as the quality metric; re-run
  classification in the background when a new model version ships.

### Where to run the models

| Location | Verdict | Reason |
|---|---|---|
| **Home PC — SmartMirror worker (ONNX Runtime, CPU or GPU)** | ✅ **Primary** | photos never leave home; no per-call cost; HomePilot GPU available when present |
| **Browser / phone — transformers.js (WebGPU, q8)** | ✅ Optional preview | instant "looks like a black skirt" while uploading; authoritative result still from the worker |
| **Echo Show 21 (4 GB, WebView)** | ❌ | too constrained; the Echo only displays and uploads |
| **Vercel functions** | ❌ | would move personal photos to the cloud; serverless size and time limits |
| **Cloud vision APIs** | ⚠️ Opt-in fallback only | through HomePilot's compute router, never by default |

> Performance note: ViT-B-sized encoders are typically sub-second per image on a
> modern desktop CPU and much faster on a GPU; exact figures must be measured on
> the target PC (add a benchmark job to the probe checklist).

---

## 5. Data model additions

Extends the entities in the executive architecture (WardrobeItem, GarmentAsset,
GarmentEmbedding already defined).

```text
WardrobeItem       + ai_metadata jsonb, user_metadata jsonb, effective_metadata jsonb
                   + confidence jsonb, source (phone|mirror|purchase|link|manual)
                   + external_ref (e.g. ASIN) nullable, status (active|archived|wishlist)

GarmentAsset       asset_type: original | cutout | thumbnail | mask

ClassificationRun  id, wardrobe_item_id, stage, model_id, model_version,
                   scores jsonb, latency_ms, created_at

OutfitSet          id, profile_id, name ("Office week", "Paris trip"), kind (capsule|occasion|trip),
                   rules jsonb (occasion, season, colour palette), created_at
OutfitSetMember    set_id, outfit_id | wardrobe_item_id, position

ShoppingQuery      id, profile_id, trigger (gap|request|complete_look), spec jsonb, created_at
ShoppingCandidate  id, query_id, provider, external_id (ASIN), title, image_url,
                   price, currency, url (tagged), fetched_at, expires_at,
                   embedding (optional), score, reasons jsonb
```

Shopping rows are **cache, not truth**: they expire and are refreshed per the
provider's rules (see §8.4).

---

## 6. Building outfits and sets

### 6.1 Outfit templates (slots)

```text
A: top + bottom + shoes (+ layer) (+ bag/accessory)
B: dress/jumpsuit + shoes (+ layer) (+ bag/accessory)
```

### 6.2 Scoring (weights in config, as in the architecture)

```text
score = 0.30 intent relevance      (text-embedding of request ↔ item embeddings + attributes)
      + 0.25 pairwise compatibility (embedding-based compatibility across slots)
      + 0.15 colour harmony         (rules: neutrals, tonal, complementary; clashing penalised)
      + 0.10 occasion / season fit  (zero-shot tags; optional weather)
      + 0.10 user preference        (liked/disliked colours, fits, past feedback)
      + 0.10 freshness              (not worn/suggested recently)
```

Search is beam-style: shortlist per slot with pgvector + filters, then score
combinations; return the top N **complete** outfits. HomePilot's LLM is used to
**parse intent and write the explanation**, not to pick items. That keeps
results grounded in clothes the user owns.

### 6.3 Sets

- **Capsule / occasion sets**: "Office week" = 5 outfits with minimal repeats,
  one palette; "Weekend in Paris" = N days, fits in a carry-on (item count cap).
- Built by the same scorer with **set-level constraints** (coverage, reuse
  limits, palette) using a greedy + swap-improvement pass.
- Users can pin items, lock an outfit, and save/rename sets; feedback updates
  preference weights.

### 6.4 Gap analysis (feeds shopping)

Detect what the wardrobe cannot satisfy:

- **Request gaps**: "black mini skirt for dinner" with no black mini skirt → a
  structured spec `{category: skirt, length: mini, colour: black, occasion: evening}`.
- **Coverage gaps**: few or no versatile items in a slot (e.g. no neutral
  shoes that pair with ≥60 % of tops).
- **Completion gaps**: an outfit scores well but lacks an outer layer or bag.

---

## 7. Agentic workflow (HomePilot MCP)

New SmartMirror MCP tools (allow-listed via `HOMEPILOT_MIRROR_ALLOWED_TOOLS=smartmirror.*`):

```text
smartmirror.wardrobe_ingest      photo/media ref → job id (runs the pipeline)
smartmirror.wardrobe_review      pending items + confidences
smartmirror.wardrobe_confirm     accept / correct fields (records user_metadata)
smartmirror.set_create           name + rules → proposed set
smartmirror.set_get / set_list
smartmirror.gap_analyze          request or whole wardrobe → gap specs
smartmirror.shop_suggest         gap spec / "complete the look" → ranked candidates
smartmirror.shop_mark_purchased  candidate → wardrobe item (pre-filled)
```

```text
User: "What should I wear to a wedding in October? Buy what I'm missing."
  │
  ▼ HomePilot planner (LLM)
  ├─ smartmirror.style_suggest(intent)          → best outfits from owned clothes
  ├─ smartmirror.gap_analyze(intent)            → [{category: heels, colour: nude, occasion: wedding}]
  ├─ smartmirror.shop_suggest(gap, budget)      → 3 ranked products that pair with owned items
  └─ answer: outfits + "complete the look" + QR to buy on phone
```

---

## 8. Amazon integration

### 8.1 Current API reality (verified September 2026)

- **PA-API 5.0 is retired.** It was deprecated on 30 April 2026 and retired on
  15 May 2026; calls now return 403 `AccessDeniedException`.
- The successor is the **Amazon Creators API**, a REST catalogue API.
  - **Auth:** OAuth 2.0 client credentials through Login with Amazon (credential
    IDs start with `amzn1.`). Tokens last about an hour, so cache them.
  - **Operations:** item search, get items, variations and browse nodes, with
    lowerCamelCase fields (`itemIds`, `partnerTag`). Offers are moving to OffersV2.
  - **Scope:** credentials are per region (NA / EU / FE), not per marketplace.
- **Eligibility:**
  - an approved Amazon Associates account;
  - **≥ 10 qualifying sales in a rolling 30-day window**, otherwise access is
    suspended until sales recover.
- **Rate limits:** new credentials start at **1 request/second, 8,640/day**,
  scaling with sales.
- **Read-only:** there is no ordering API. Purchases happen on Amazon.

**Consequence:** a personal/home deployment will usually **not** meet the
10-sales rule. The design therefore has two tiers.

### 8.2 Provider tiers

```text
ShoppingProvider (interface)
├── AmazonLinkOutProvider      MVP · no API · always available
│     builds a tagged search URL from the gap spec
│     https://www.amazon.<tld>/s?k=<query>&tag=<partnerTag>
│     shown as a QR / "open on phone"; no product data displayed in-app
├── AmazonCreatorsProvider     when the Associates account is eligible
│     search + getItems + variations → real products (image, price, ASIN)
└── (future) other retailers / affiliate networks behind the same interface
```

The UI and MCP contract are identical for both. Only the richness of the result
differs, so eligibility can come and go without breaking the product.

### 8.3 Recommendation flow (Creators tier)

```text
gap spec ─▶ query builder (keywords + browse node + filters: size, price band, prime)
        ─▶ Creators search (≤ 1 TPS, token cached, results cached per policy)
        ─▶ candidate images ─▶ Marqo-FashionSigLIP embeddings (on the home PC)
        ─▶ score = attribute match + compatibility with owned items
                   + price fit + rating/reviews + (optional) brand preference
        ─▶ top 3 with reasons: "Pairs with 6 things you own · matches your palette"
        ─▶ optional: AI try-on preview with the product image (labelled as a preview)
        ─▶ "Buy on phone" (QR, tagged URL)   |   "I bought it" → wardrobe (pre-filled)
```

### 8.4 Compliance and privacy rules

- Credentials live **only on the home SmartMirror service** (or server-side env),
  never in the browser, the Echo or `NEXT_PUBLIC_*`.
- Send Amazon **text queries only**; never user photos, body data or wardrobe images.
- Show prices with their fetch time and refresh or hide them per the Associates
  Operating Agreement and Creators API terms. Include the required affiliate
  disclosure wherever tagged links appear. Confirm exact caching/display limits
  in the Associates policies before launch.
- Respect the rate limit with a token bucket in the worker; degrade to link-out
  on 403/429 or when eligibility lapses.
- Shopping is **opt-in** in Settings (off by default), with a budget cap and
  "never suggest" brands/categories.

### 8.5 Where it runs

`smartmirror.shop_suggest` runs in the **SmartMirror service at home**, reached
through HomePilot MCP and OllaBridge like every other tool. Outbound HTTPS to
Amazon from home is fine. The Vercel BFF only relays the allow-listed tool call.
Link-out can be generated anywhere because it needs no credentials.

---

## 9. UX touchpoints

- **Wardrobe → "Add clothes"**: QR for phone snap / closet scan; review queue badge.
- **Stylist results**: when a request has a gap, a quiet *"Complete the look"*
  row (1–3 items) appears under the owned-clothes outfits, never above them.
- **Sets**: "Plan my week", "Pack for a trip" chips on the stylist.
- **Echo**: products open on the phone (QR), since the Echo is not a checkout
  device; "I bought it" closes the loop into the wardrobe.

---

## 10. Phased delivery

| Phase | Deliverable | Exit metric |
|---|---|---|
| W1 | Upload + cut-out + FashionSigLIP zero-shot + LAB colour + review queue | ≥ 85 % category top-1 on a 200-item household test set; ≤ 2 presses per correction |
| W2 | pgvector search, kNN personalisation, closet-scan batch | correction rate falls week over week |
| W3 | Outfit scorer v2 (compatibility + colour harmony) and **sets** | users save ≥ 1 set; outfit acceptance rate |
| W4 | Gap analysis + **Amazon link-out** | click-through on "complete the look" |
| W5 | **Creators API** provider (when eligible), product embeddings, "I bought it" | share of purchases added to wardrobe |
| W6 | Worn-garment parsing (SegFormer), multi-item detection (YOLOS) | items added per session |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Zero-shot confuses near categories (blazer vs jacket, top vs blouse) | hierarchical labels, kNN on confirmed items, one-press corrections |
| Colour shifts from home lighting | cut-out + LAB k-means, grey-world white balance, user can pin colour |
| Amazon eligibility (10 sales/30 days) not met | link-out provider is the default; Creators is an upgrade |
| Amazon API/policy changes | provider interface, feature flag, contract tests with recorded fixtures |
| Model licences | prefer Apache-2.0/MIT (FashionSigLIP, FashionCLIP); record licence per model in the model registry |
| Sensitive photos | processing at home; EXIF stripped; no photos to shopping providers; retention rules unchanged |

---

## Sources

- Marqo-FashionCLIP / FashionSigLIP: [collection](https://huggingface.co/collections/Marqo/marqo-fashionclip-and-marqo-fashionsiglip), [model card](https://huggingface.co/Marqo/marqo-fashionSigLIP), [GitHub](https://github.com/marqo-ai/marqo-FashionCLIP), [blog](https://www.marqo.ai/blog/search-model-for-fashion)
- FashionCLIP 2.0: [model card](https://huggingface.co/patrickjohncyh/fashion-clip), [GitHub](https://github.com/patrickjohncyh/fashion-clip)
- SegFormer clothes: [mattmdjaga/segformer_b2_clothes](https://huggingface.co/mattmdjaga/segformer_b2_clothes)
- YOLOS Fashionpedia: [model](https://huggingface.co/valentinafeve/yolos-fashionpedia), [fine-tuning repo](https://github.com/valentinafeve/fine_tunning_YOLOS_for_fashion)
- Background removal: [rembg](https://github.com/danielgatis/rembg), [BiRefNet vs rembg vs U2Net](https://dev.to/om_prakash_3311f8a4576605/birefnet-vs-rembg-vs-u2net-which-background-removal-model-actually-works-in-production-2j70)
- In-browser inference: [Transformers.js docs](https://huggingface.co/docs/transformers.js/en/index), [zero-shot image classification](https://huggingface.co/docs/transformers/tasks/zero_shot_image_classification)
- Amazon: [PA-API 5 deprecation notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation), [Creators API introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction), [PA-API retirement dates](https://dev.to/th3nate/amazon-pa-api-v5-is-shutting-down-april-30-2026-here-is-what-changes-at-the-auth-layer-22ek), [what changed in the Creators API](https://www.keywordrush.com/blog/amazon-creator-api-what-changed-and-how-to-switch/), [eligibility and rate limits](https://velantio.com/blog/how-to-get-amazon-creators-api-access), [10-sales rule](https://www.keywordrush.com/blog/amazon-pa-api-associatenoteligible-error-is-there-a-new-10-sales-rule/), [Associates policies](https://affiliate-program.amazon.com/help/operating/policies)
