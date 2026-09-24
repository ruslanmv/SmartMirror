import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string) => jar.set(name, { value }),
    delete: (arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
}));

import { POST as chat } from "@/app/api/stylist/chat/route";
import { GET as personas } from "@/app/api/stylist/personas/route";
import { writeSession } from "@/lib/server/session";
import {
  CLIENT_TYPE,
  StylistError,
  buildMessages,
  chatCompletion,
  demoReply,
  groundingBlock,
  isPersonaModel,
  parseModels,
  pickStylist,
  replyText,
} from "@/lib/server/stylist";

const TOKEN = "tok_device_secret";
const MODELS = {
  data: [
    { id: "qwen2.5:1.5b" },
    { id: "persona:angel--1a2b3c4d", name: "Angel" },
    { id: "persona:stylist--9f8e7d6c", name: "Stylist" },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function completion(text: string) {
  return json({ choices: [{ message: { role: "assistant", content: text } }] });
}
function req(body: unknown) {
  return new Request("http://mirror.test/api/stylist/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 200)}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => jar.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("stylist helpers", () => {
  it("only accepts persona models", () => {
    expect(isPersonaModel("persona:stylist--9f8e7d6c")).toBe(true);
    expect(isPersonaModel("personality:therapist")).toBe(true);
    expect(isPersonaModel("gpt-5")).toBe(false);
    expect(isPersonaModel("persona:../../etc")).toBe(false);
    expect(parseModels(MODELS).map((m) => m.id)).toEqual(["persona:angel--1a2b3c4d", "persona:stylist--9f8e7d6c"]);
    expect(parseModels(null)).toEqual([]);
  });

  it("discovers the stylist persona, honouring an explicit choice", () => {
    const list = parseModels(MODELS);
    expect(pickStylist(list)?.id).toBe("persona:stylist--9f8e7d6c");
    expect(pickStylist(list, "persona:angel--1a2b3c4d")?.id).toBe("persona:angel--1a2b3c4d");
    expect(pickStylist(list, "persona:gone--00000000")?.id).toBe("persona:stylist--9f8e7d6c");
    expect(pickStylist([{ id: "persona:mia--1", name: "Mia the Stylist" }])?.id).toBe("persona:mia--1");
    expect(pickStylist([{ id: "persona:angel--1", name: "Angel" }])).toBeNull();
  });

  it("grounds the persona in owned items only when there are some", () => {
    const items = [
      { id: "i1", name: "Black silk slip dress", category: "dress", color: "black" },
      { id: "i2", name: "Camel wool coat", category: "outerwear" },
    ];
    expect(groundingBlock([])).toBeNull();
    const block = groundingBlock(items)!;
    expect(block.startsWith("Owned items")).toBe(true);
    expect(block).toContain("- Black silk slip dress (dress, black)");
    expect(block).toContain("- Camel wool coat (outerwear)");

    const withItems = buildMessages("Dinner tonight?", items, [{ role: "user", content: "hi" }]);
    expect(withItems[0]).toMatchObject({ role: "system" });
    expect(withItems.at(-1)).toEqual({ role: "user", content: "Dinner tonight?" });
    // No local system prompt otherwise: the remote persona brings its own.
    expect(buildMessages("Dinner tonight?", [], [])).toEqual([{ role: "user", content: "Dinner tonight?" }]);
  });

  it("reads replies and builds a speakable demo answer", () => {
    expect(replyText({ choices: [{ message: { content: "  Wear the navy.  " } }] })).toBe("Wear the navy.");
    expect(replyText({ choices: [] })).toBeNull();
    expect(demoReply("dinner", [{ id: "a", name: "Black dress" }, { id: "b", name: "Gold heels" }])).toBe(
      "Go with the black dress and gold heels. It reads polished for the evening.",
    );
    expect(demoReply("anything", [])).toMatch(/Tell me the occasion/);
  });
});

describe("chatCompletion", () => {
  it("retries transient relay errors, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ detail: "bad gateway" }, 502))
      .mockResolvedValueOnce(json({ detail: "unavailable" }, 503))
      .mockResolvedValueOnce(completion("Wear the navy blazer."));
    vi.stubGlobal("fetch", fetchMock);
    const text = await chatCompletion("https://ob.test", TOKEN, "persona:stylist--1", [{ role: "user", content: "x" }], [0, 0]);
    expect(text).toBe("Wear the navy blazer.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ob.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["X-Client-Type"]).toBe(CLIENT_TYPE);
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "persona:stylist--1", stream: false });
  });

  it("maps errors to clear reasons", async () => {
    const run = (status: number) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, status)));
      return chatCompletion("https://ob.test", TOKEN, "persona:s--1", [], [0, 0]).catch((e: StylistError) => e.code);
    };
    expect(await run(401)).toBe("pairing_required");
    expect(await run(404)).toBe("no_persona");
    expect(await run(504)).toBe("timeout");
    expect(await run(500)).toBe("upstream");
  });
});

describe("/api/stylist/chat", () => {
  it("demo backend answers from the grounding items", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
    const res = await chat(req({ prompt: "dinner date", items: [{ id: "a", name: "Black dress" }] }));
    expect(await res.json()).toMatchObject({ reply: "Go with the black dress. It reads polished for the evening.", grounded: true });
  });

  it("ollabridge: talks to the stylist persona with the device token", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://ob.test");
    vi.stubEnv("OLLABRIDGE_TOKEN", "");
    vi.stubEnv("OLLABRIDGE_STYLIST_MODEL", "");
    vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "k".repeat(40));
    await writeSession({ kind: "device", deviceToken: TOKEN });

    const calls: [string, RequestInit][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return url.endsWith("/v1/models") ? json(MODELS) : completion("Wear the black dress with the camel coat.");
      }),
    );

    const res = await chat(
      req({
        prompt: "Rooftop dinner, a bit cold",
        items: [
          { id: "i1", name: "Black silk slip dress", category: "dress", color: "black" },
          { id: "i2", name: "Camel wool coat", category: "outerwear" },
        ],
        model: "gpt-5", // not a persona: ignored
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      reply: "Wear the black dress with the camel coat.",
      persona: { id: "persona:stylist--9f8e7d6c", name: "Stylist" },
      grounded: true,
    });
    expect(text).not.toContain(TOKEN);

    const [chatUrl, chatInit] = calls.find(([u]) => u.endsWith("/v1/chat/completions"))!;
    expect(chatUrl).toBe("https://ob.test/v1/chat/completions");
    expect((chatInit.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(chatInit.body as string);
    expect(body.model).toBe("persona:stylist--9f8e7d6c");
    expect(body.messages[0].content).toContain("- Camel wool coat (outerwear)");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Rooftop dinner, a bit cold" });
  });

  it("explains how to publish the persona when none is found", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://ob.test");
    vi.stubEnv("OLLABRIDGE_TOKEN", "");
    vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "k".repeat(40));
    await writeSession({ kind: "device", deviceToken: TOKEN });
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "persona:angel--1", name: "Angel" }] })));

    const res = await chat(req({ prompt: "office" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "no_persona", error: expect.stringContaining("stylist.hpersona") });
    expect((await (await personas()).json()).personas).toEqual([{ id: "persona:angel--1", name: "Angel" }]);
  });

  it("requires pairing and a prompt", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://ob.test");
    vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "k".repeat(40));
    expect((await chat(req({ prompt: "x" }))).status).toBe(401);
    expect((await chat(req({ prompt: "  " }))).status).toBe(400);
  });
});
