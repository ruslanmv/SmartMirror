# Smart Mirror experience: mental model and interaction rules

## 1. The mental model

People already know how to use a mirror: **walk up, look, leave**. Every
Smart Mirror feature has to fit that loop, not replace it. The screen is a
mirror first, a camera second, and an app third.

```text
 AMBIENT            ENGAGE              CAPTURE             CUSTOMISE (AI)          KEEP
 nobody there  ──▶  you step in   ──▶   one action    ──▶   one clear next step ──▶ saved, or gone
 painting /         live mirror         3·2·1 · flash       Style me                in 24 h
 real mirror        (default)           photo freezes       Try it on
                                                            Make it art
     ▲                                                                                  │
     └──────────────────────────── idle timeout / Done / Back ─────────────────────────┘
```

| State | What the screen does | How you get out |
|---|---|---|
| **Ambient** | Fill screen: real mirror, or your portrait as a framed painting | Any key, tap or movement |
| **Engage** | Home with the live mirror in the arch; one primary action (Snap) | Walk away (idle → ambient) |
| **Capture** | 3·2·1 with beeps, flash; the camera switches off | Tap / Back cancels the countdown |
| **Customise** | The photo stays frozen in the arch: Style me · Try it on · Make it art | Retake, or Live mirror to go live again |
| **Keep** | Photo stays on this screen for 24 h; saved looks until deleted | Settings / Delete photo |

## 2. Interaction rules (industry practice applied)

Sources: retail smart-mirror deployments (fitting-room mirrors, beauty
try-on), photo-booth UX, TV "10-foot UI" guidelines (Amazon Fire TV, Android
TV), and platform privacy patterns (camera indicators on iOS/Android/macOS).

1. **The mirror is the button.** When the live mirror is on, tapping the arch,
   pressing OK on the remote, or saying *"Alexa, take my photo"* all take a
   photo. No hunting for a "Take photo" screen.
2. **Hands-free capture.** A 3-second countdown with audible beeps lets you
   step back and pose; the flash confirms the shot. Tapping again cancels.
3. **One primary action per state.** Live → *Snap*. Review → *Style me*.
   Secondary options are visible but visually quieter (ghost buttons).
4. **Undo over confirm.** The photo is saved immediately; *Retake* replaces it.
   No "Are you sure?" dialogs.
5. **The picture you took stays put.** After the shutter the camera turns off and
   the photo remains frozen in the arch, like a print from a photo booth, until
   you choose Retake or Live mirror (remembered for the session). The home screen
   can still fall back to the ambient portrait after an idle period.
6. **Always visible privacy state.** A red "Camera on" pill appears whenever the
   camera streams. Photos stay on the screen (24 h) or on your HomePilot; the
   cloud only relays.
7. **10-foot legibility.** Large type and hit targets that scale with the
   screen; everything reachable with arrows + OK + Back; nothing depends on touch.
8. **Graceful degradation.** No camera → phone QR code. Camera blocked →
   explained, with *Use my phone* and *Retry*. Offline → banner; saved looks
   still work.
9. **Voice mirrors the screen.** Every voice command maps to a visible state
   ("take my photo", "show my portrait", "what should I wear to dinner").
10. **Defaults that feel like a mirror.** Live mirror on, fill screen = real
    mirror. Artistic and AI features are one step away, never in the way.

## 3. The core flow in detail

```text
Home (live mirror)
  │  tap arch · OK · "Alexa, take my photo" · Snap
  ▼
3 · 2 · 1  (beep each second; tap/Back = cancel)
  │
  ▼
flash → camera off → photo frozen in the arch → saved on this screen
  │
  ├─ Style me     → Stylist ("Your new photo is ready") → pick a look → Try it on
  ├─ Try it on    → Try-on with the latest outfit suggestion and this photo
  ├─ Make it art  → Fill screen as a painting of this photo
  ├─ Retake       → camera on, 3 · 2 · 1 again
  └─ Live mirror  → camera on, back to the live mirror
```

## 4. Next improvements (not yet built)

- **Presence detection:** wake from ambient when someone stands in front
  (camera motion or the Echo's presence sensor) instead of needing a key.
- **Pose guide:** a faint full-body outline during the countdown, and a
  "step back" hint when the face fills too much of the frame.
- **Burst & best shot:** take three frames and keep the sharpest.
- **AI edit presets on the review screen:** "Evening look", "Change colour",
  "Studio background", generated on the owner's HomePilot.
- **Before/after slider** for try-on results.
- **Per-person profiles** (face-free: pick your avatar) for shared mirrors.
