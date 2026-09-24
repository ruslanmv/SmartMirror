# Smart Mirror Alexa skill

“Alexa, open Smart Mirror” launches the same web UI that runs on Vercel.

```text
Alexa skill (lambda/index.mjs)
   │
   ├── device supports Alexa.Presentation.HTML?
   │       YES → Alexa.Presentation.HTML.Start  →  https://<deployment>/alexa
   │             later intents → HTML.HandleMessage → web app routes the screen
   │
   └──     NO  → APL card (or voice) pointing to the Echo app / a browser
```

HTML support is separate from APL support, so the handler checks
`context.System.device.supportedInterfaces["Alexa.Presentation.HTML"]` on every
request instead of assuming every Echo Show has it.

## Messages

Skill → web app (`HandleMessage` and the `Start` `data` payload):

```json
{ "intent": "StyleIntent", "prompt": "dinner tonight" }
```

`intent` is one of `LaunchRequest`, `StyleIntent`, `WardrobeIntent`,
`TryOnIntent`, `PhotoIntent`, `HomeIntent` (see `AlexaDirective` in
`packages/device-capabilities`). The web app can reply with
`alexa.skill.sendMessage({ speech: "..." })`, which the skill speaks.

The simulator's “Alexa voice” panel sends exactly these directives, so the
routing can be tested without a device.

## Deploy

1. Create a Node.js 20 Lambda from `skill/lambda/index.mjs` and set
   `SMARTMIRROR_WEB_URL` to your Vercel production URL.
2. Put the Lambda ARN in `skill/skill.json`, then deploy the skill with the ASK
   CLI (`ask deploy`) or paste the interaction model into the developer console.
3. Enable the **Alexa Web API for Games** (HTML) and **APL** interfaces.
