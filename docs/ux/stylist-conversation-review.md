# Stylist conversation: review and redesign

Review of how the Smart Mirror stylist talks and suggests, against what owners
actually ask for: **suggestions for the day** ("work day", "shopping day"),
**suggestions for a desire or mood** ("love day", "sexy day", "lazy day"),
**reacting to clothes they just added**, and the **clothes detector** that feeds
all of it. Date: 4 October 2026 · branch `claude/upbeat-maxwell-sky163`.

## 1. How it works today

```text
Owner (voice, chips or typed)
  └─► stylist page composes one prompt: "<text> — for <occasion>, <mood> feel, in <colour>"
        ├─► style_suggest (PC): parse_intent → occasion + colours + cold/warm → 3 complete looks
        └─► persona chat (HomePilot "Stylist"): system prompt + "Owned items" block + prompt
              → 1–3 spoken sentences
```

What is good and should stay:

- **Grounded.** The persona may only name items from the "Owned items" block,
  and every engine explanation cites only the chosen pieces.
- **Spoken-first.** Three short sentences, no lists or emoji; it fits the Echo
  across the room.
- **Respectful.** It never comments on body, weight or attractiveness.
- **Complete outfits.** A dress, or a top with a bottom, plus a layer, shoes and
  a bag, with gaps named when something is missing.

## 2. Findings

Probe of the real engine (`smartmirror/stylist/engine.py`) with a nine-piece wardrobe:

| Owner says | Engine understood | Look returned | Verdict |
|---|---|---|---|
| "work day" | office | Office blouse: blouse, trousers, blazer, heels | good |
| "rainy work day" | office, cold | same, with the blazer as the layer | good |
| "valentine's dinner" | evening | Evening slip dress + blazer, heels, clutch | good |
| "shopping day" | casual | Easy t-shirt: tee, jeans, sneakers | right look, half the meaning (see F4) |
| **"love day"** | nothing | "Everyday slip dress" | **mood ignored** |
| **"sexy day"** | nothing | "Everyday slip dress" | **mood ignored** |
| **"something sexy for tonight"** | nothing ("tonight" unknown) | "Everyday slip dress" | **mood and time ignored** |
| **"I feel lazy"** | nothing | "Everyday slip dress", no shoes rule | **mood ignored** |

**F1. Desire and mood are not part of the model.** `parse_intent` knows
occasions, colours and cold/warm, nothing else. The stylist screen offers mood
chips (Elegant, Relaxed, Minimal, Bold, Sexy, Sporty) that end up only as words
in the prompt. "Love", "romantic", "sexy", "flirty", "cosy", "lazy" and
"confident" change nothing about the look; any wardrobe whose best-scoring
anchor happens to be a dress gets the same answer for every mood.

**F2. The stylist does not know what day it is.** No date, weekday, time of day,
weather or plan reaches the engine or the persona. The home screen knows the time
(it says "Good evening") but its quick ideas are a fixed list (Dinner date,
Office day, Weekend brunch, Cocktail party, Travel day), the same on a Monday
morning and a Saturday night. Outfit plans ("Plan my week") are saved on the PC,
but nothing says "today is Tuesday, your plan says the navy trousers".

**F3. Conversations are one turn long.** The persona is told to ask one short
question when a request is vague, but the stylist page never sends the history
(`api.stylistChat` is called without `history`, although the route supports
it). The owner's answer ("dinner") starts a fresh conversation, and the tools
re-run on "dinner" alone, losing "sexy" or "for Saturday".

**F4. Ambiguous days are guessed, not asked.** "Shopping day" can mean *going
shopping* (comfortable shoes, a bag with room, easy layers) or *wanting to buy
something* (what is the wardrobe missing?). Today it silently picks the first.

**F5. Adding clothes is a dead end conversationally.** After a closet scan the
screen says "Added to your wardrobe" and stops. The best moment to delight
("the navy skirt works with your ivory blouse for work; want to see it?") is
missed, and so is the moment to confirm the detector got it right.

**F6. The detector describes what a garment is, not what it is for.** It reports
category, 25 subcategories, colour and solid/patterned. Mood and day matching
need *use* attributes the engine can score: formality (casual → black tie),
warmth (summer → winter), vibe (romantic, alluring, sporty, cosy, power),
comfort for walking. Common pieces are missing from the vocabulary: jumpsuit,
cardigan, mini skirt, crop top, bodysuit, loafers, flats, crossbody bag. The
demo wardrobe carries `occasions` tags, but the real engine never reads item
metadata.

**F7. Two engines disagree.** The demo engine (`apps/web/lib/server/demo.ts`)
maps "sexy" and "elegant" to evening; the real one does not. A preview in demo
mode shows behaviour the owner will not get at home.

**F8. "Sexy" needs an explicit, tasteful rule.** The persona correctly refuses
to talk about bodies, but has no guidance for alluring requests, so it may
dodge them or answer vaguely. Owners ask for this a lot; it should be a
first-class style request described through silhouette, fabric, colour and
confidence.

## 3. Redesign

### 3.1 One intent model: occasion × vibe × context

```text
Intent
├── occasion   work · date · party · formal · shopping · errands · travel · sport · home · interview
├── vibe       romantic · alluring · confident · relaxed · playful · minimal · bold · elegant
├── constraints colours · dress code · walking a lot · weather (cold/rain/heat)
└── context    weekday · time of day · today's plan · recent additions   (from the screen and PC)
```

Day words resolve to both an occasion and a vibe:

| Owner says | Occasion | Vibe | What the look leans on |
|---|---|---|---|
| love day · valentine · anniversary · romantic | date | romantic | dress or soft blouse, warm or soft colours (red, pink, cream), heels or smart flats, a small bag |
| sexy day · sexy night · flirty · hot | from time of day (night → party/date, day → none) | alluring | slip dress, fitted or mini silhouette, black or red, heels; described as "fitted silk", "a little shine", never the body |
| work day · office · meeting | work | confident | tailoring, a layer, shoes you can walk in |
| interview | interview | confident + minimal | the most formal tailored look, neutral colours |
| shopping day | shopping | relaxed | comfortable shoes, crossbody bag, a layer that comes off easily; then offer *"Want me to list what your wardrobe is missing?"* |
| lazy day · cosy · stay home | home | relaxed | knitwear, soft trousers, no heels |
| party · night out | party | bold | statement piece, heels |
| travel · trip · flight | travel | relaxed | layers, sneakers or flats, no heels |

`engine.py` adds a `vibe` score next to occasion (item subcategory, colour and
the detector's vibe tags; see 3.4). When only a vibe is given, the time of day
supplies the occasion: "sexy" at 20:00 → alluring + party/date; at 09:00 →
alluring + everyday, with tasteful daywear. **One lexicon file** in
`packages/contracts` drives both the Python engine and the demo, so they agree.

### 3.2 The stylist knows the day

The web BFF adds a short context block to every stylist request; the screen
already knows most of it:

```text
Today: Saturday 4 October, evening.
Weather: 12 °C, light rain.                      (optional, owner opts in; city set in Settings)
Plan: "Weekend trip · Day 2": Camel knit, Blue jeans, White sneakers.   (from outfit plans)
New in the wardrobe this week: Navy midi skirt.
```

- **Home screen chips by day.** The chips follow the day and are ordered by
  what is likely: weekday mornings → *Work day · Interview · Errands*; Friday and
  Saturday evenings → *Love day · Sexy night · Party*; weekend mornings →
  *Shopping day · Brunch · Lazy day*. If today has a plan, the first card is
  "Today's look" from it.
- **Morning line** (when the mirror wakes, at most once a day, can be turned
  off): *"Good morning. Your plan says the navy trousers and ivory blouse; it's
  rainy, so take the trench."*
- **Calendar** (later, opt-in through HomePilot): event titles become
  occasions ("Dinner with Sam 20:00" → date, evening). Titles are used, never
  stored by SmartMirror.

### 3.3 Real conversations, with at most one question

- Send the last 6 turns (`history`) with every stylist request, and keep
  the parsed intent between turns, so "dinner" answers "what's the occasion?"
  instead of replacing "something sexy".
- **Ask only when the answer changes the look**, as one question with 2–4 chip
  answers that the remote can select:
  - "sexy" with no time → *"Day or night?"* `Daytime · Tonight`
  - "shopping day" → *"Going shopping, or shopping for something?"* `Out shopping · Fill a gap`
  - nothing at all → no question; use the day context.
- Never ask twice in a row; on a second vague answer, choose and say why.

Sample flows (spoken, ≤ 3 sentences):

```text
Owner: Alexa, ask Smart Mirror for a sexy look.
Stylist: Day or night?                      [Daytime] [Tonight]
Owner: Tonight.
Stylist: Your black silk slip dress with the heels and the gold clutch: fitted,
         a little shine, very evening. Add the charcoal blazer if it's cold out.

Owner: It's a love day.
Stylist: The ivory silk blouse with your navy trousers and the black heels,
         soft and polished for a date. Want something bolder? Try the slip dress.

Owner: Shopping day.
Stylist: Blue jeans, the white tee and your white sneakers, easy to walk in
         and quick to change. Want me to list what your wardrobe is missing?
```

### 3.4 The detector feeds the conversation

- **Use attributes, scored with the same zero-shot model:** formality (1–4),
  warmth (summer / mid / winter), vibe tags (romantic, alluring, sporty, cosy,
  power, playful) and "walkable" for shoes. They are stored as `ai_metadata`
  suggestions; the owner can change them in the review card. A low-confidence
  vibe is simply not stored, never guessed.
- **Add the missing pieces to the vocabulary:** jumpsuit, cardigan, mini skirt,
  midi skirt, crop top, bodysuit, loafers, flats, ankle boots, crossbody bag,
  tote.
- **Talk after confirming:** when a piece is confirmed, run the engine with it as
  the anchor and say one line: *"Nice, the navy midi skirt. It works with your
  ivory blouse for work; want to see it?"* `Show me · Later`. If the detector was
  unsure ("What is it?"), the stylist asks in the same friendly tone instead of
  a bare form.
- The engine reads item tags (today it ignores `metadata`), so "love day"
  prefers pieces tagged romantic, and "work day" respects formality.

### 3.5 Persona prompt changes (stylist.hpersona)

Add to the system prompt, keeping the current rules:

```text
Context:
- A "Today" block may tell you the date, time of day, weather, today's plan and new pieces.
  Use it; do not mention it unless it matters (rain → a layer; a plan → offer it first).

Moods and days:
- "Love day", "valentine", "anniversary", "romantic": a date look, soft and warm.
- "Sexy", "hot", "flirty": a confident, alluring look. Describe it through silhouette,
  fabric, colour and finishing touches ("fitted silk", "a little shine", "red lip-ready").
  Never describe or rate the owner's body. If time of day is unknown, ask "Day or night?".
- "Shopping day": an easy walking outfit, then offer to list what the wardrobe is missing.
- "Lazy day", "cosy": comfort first; no heels.
- Ask at most one question, only when the answer changes the outfit, and offer 2–4 short
  options. Never ask twice in a row.
- When a "New in the wardrobe" line is present and fits the request, prefer that piece.
```

### 3.6 Privacy

Mood, day and calendar context are sent per request and not stored by
SmartMirror. Weather needs only a city and is opt-in; the calendar is opt-in
through HomePilot. The stylist never infers relationship status, gender or body
from what the owner asks for.

## 4. Acceptance checks

Engine (Python, with a fixed wardrobe):

- "love day" → occasion `date`, vibe `romantic`; the top look is a dress or a blouse
  with heels or smart flats.
- "sexy day" at 20:00 → vibe `alluring`, evening; at 09:00 → vibe `alluring`, no
  evening bag.
- "work day" → `work`, `confident`, includes a layer when available.
- "shopping day" → `shopping`; no heels; gaps offered when shopping is enabled.
- "lazy day" → `home`, `relaxed`; no heels, no blazer.
- The demo engine gives the same occasion and vibe for every row (shared lexicon).

Conversation (web):

- "something sexy" → "Day or night?" with chips → "Tonight" keeps `alluring`.
- History is sent; the second turn's tools run on the merged intent.
- After a garment is confirmed, one stylist line names that piece and one owned partner.

Persona (prompt tests with a mock model): never mentions the body for "sexy";
never asks two questions in a row; names only owned items.

## 5. Order of work

| # | Change | Size | Fixes |
|---|---|---|---|
| 1 | Shared mood/day lexicon; `vibe` in `parse_intent` and scoring; time-of-day default; demo engine uses it | S | F1, F7 |
| 2 | Send `history`, keep intent across turns; one-question chips | S | F3, F4 |
| 3 | "Today" context block (date, time, plan, new pieces); day-ordered home chips with *Love day · Sexy night · Work day · Shopping day · Lazy day* | S | F2 |
| 4 | Persona prompt update + rebuilt `stylist.hpersona` | S | F8 |
| 5 | Stylist line after confirming a garment | S | F5 |
| 6 | Detector use-attributes + vocabulary; engine reads item tags | M | F6 |
| 7 | Morning line; weather (opt-in) | M | F2 |
| 8 | Calendar events through HomePilot (opt-in) | L | F2 |
