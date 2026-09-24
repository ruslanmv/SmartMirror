/**
 * SmartMirror Alexa skill handler (no dependencies; Node.js 20+ Lambda).
 *
 * If the device supports Alexa.Presentation.HTML, launch the Vercel web UI and
 * forward later intents to it with HandleMessage. Otherwise fall back to an
 * APL card (or voice only) that points the user at the Echo app or a browser.
 */

const WEB_URL = process.env.SMARTMIRROR_WEB_URL ?? "https://smart-mirror.vercel.app";
const ALEXA_ENTRY = `${WEB_URL.replace(/\/+$/, "")}/alexa`;

const INTENT_MAP = {
  StyleIntent: "StyleIntent",
  WardrobeIntent: "WardrobeIntent",
  TryOnIntent: "TryOnIntent",
  PhotoIntent: "PhotoIntent",
  PortraitIntent: "PortraitIntent",
  "AMAZON.NavigateHomeIntent": "HomeIntent",
};

function interfaces(envelope) {
  return envelope.context?.System?.device?.supportedInterfaces ?? {};
}

function supportsHtml(envelope) {
  return Boolean(interfaces(envelope)["Alexa.Presentation.HTML"]);
}

function supportsApl(envelope) {
  return Boolean(interfaces(envelope)["Alexa.Presentation.APL"]);
}

/** True once the web app is running in this session (set on HTML.Start). */
function htmlStarted(envelope) {
  return Boolean(envelope.session?.attributes?.htmlStarted);
}

function speak(text) {
  return { type: "SSML", ssml: `<speak>${text}</speak>` };
}

function respond({ text, directives = [], endSession = false, attributes = {}, reprompt }) {
  return {
    version: "1.0",
    sessionAttributes: attributes,
    response: {
      outputSpeech: text ? speak(text) : undefined,
      reprompt: reprompt ? { outputSpeech: speak(reprompt) } : undefined,
      directives,
      shouldEndSession: endSession,
    },
  };
}

function htmlStart(message) {
  return {
    type: "Alexa.Presentation.HTML.Start",
    data: message,
    request: { uri: ALEXA_ENTRY, method: "GET" },
    configuration: { timeoutInSeconds: 300 },
  };
}

function htmlMessage(message) {
  return { type: "Alexa.Presentation.HTML.HandleMessage", message };
}

function aplFallback() {
  return {
    type: "Alexa.Presentation.APL.RenderDocument",
    token: "smartmirror-fallback",
    document: {
      type: "APL",
      version: "2023.3",
      mainTemplate: {
        items: [
          {
            type: "Container",
            width: "100vw",
            height: "100vh",
            justifyContent: "center",
            alignItems: "center",
            items: [
              { type: "Text", text: "Smart Mirror", fontSize: "64dp", color: "#EFD6A8" },
              {
                type: "Text",
                text: "Open the Smart Mirror app on this Echo, or visit the link on your phone or laptop.",
                fontSize: "28dp",
                color: "#BDB4A6",
                textAlign: "center",
                width: "70vw",
                paddingTop: "24dp",
              },
              { type: "Text", text: WEB_URL.replace(/^https?:\/\//, ""), fontSize: "32dp", color: "#F6F1E9", paddingTop: "32dp" },
            ],
          },
        ],
      },
    },
  };
}

function toDirective(envelope) {
  const request = envelope.request;
  if (request.type === "LaunchRequest") return { intent: "LaunchRequest" };
  const name = request.intent?.name;
  const intent = INTENT_MAP[name];
  if (!intent) return null;
  const prompt = request.intent?.slots?.occasion?.value;
  return prompt ? { intent, prompt } : { intent };
}

export async function handler(envelope) {
  const request = envelope.request;
  const attributes = envelope.session?.attributes ?? {};

  if (request.type === "SessionEndedRequest") return respond({ endSession: true });

  // Messages the web app sends back with alexa.skill.sendMessage().
  if (request.type === "Alexa.Presentation.HTML.Message") {
    const say = typeof request.message?.speech === "string" ? request.message.speech : undefined;
    return respond({ text: say, attributes });
  }

  const name = request.intent?.name;
  if (name === "AMAZON.StopIntent" || name === "AMAZON.CancelIntent") {
    return respond({ text: "Goodbye.", endSession: true });
  }
  if (name === "AMAZON.HelpIntent") {
    return respond({
      text: "You can ask me what to wear to dinner, show your wardrobe, or take your photo.",
      reprompt: "What are you dressing for?",
      attributes,
    });
  }

  const directive = toDirective(envelope);
  if (!directive) {
    return respond({ text: "Sorry, I didn't catch that. What are you dressing for?", reprompt: "What are you dressing for?", attributes });
  }

  if (supportsHtml(envelope)) {
    if (!htmlStarted(envelope)) {
      return respond({
        text: directive.intent === "LaunchRequest" ? "Opening Smart Mirror." : "Opening Smart Mirror for you.",
        directives: [htmlStart(directive)],
        attributes: { ...attributes, htmlStarted: true },
      });
    }
    return respond({ directives: [htmlMessage(directive)], attributes });
  }

  const text =
    "Smart Mirror needs a screen that supports web apps. Open the Smart Mirror app on your Echo Show, or visit the link on your phone.";
  return respond({ text, directives: supportsApl(envelope) ? [aplFallback()] : [], endSession: true });
}
