import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

import table from "@smartmirror/contracts/stylist-intents.json";

import { POST as chat } from "@/app/api/stylist/chat/route";
import { dayContext, ideasFor, newPieces, planForToday } from "@/lib/day";
import { clarification, parseIntent } from "@/lib/intent";
import { demoSuggest, demoWardrobe } from "@/lib/server/demo";
import { buildMessages, contextBlock, demoReply } from "@/lib/server/stylist";
import type { OutfitSetView, WardrobeItem } from "@/lib/tools";

afterEach(() => vi.unstubAllEnvs());

describe("the stylist reads requests like the PC does", () => {
  it.each(table.cases)("$prompt at $hour h", (c) => {
    const i = parseIntent(c.prompt, c.hour);
    expect({ occasion: i.occasion, vibe: i.vibe, question: i.question }).toEqual({
      occasion: c.occasion,
      vibe: c.vibe,
      question: c.question,
    });
  });

  it("a question's answers carry the whole request", () => {
    const q = clarification("something sexy", parseIntent("something sexy", 10))!;
    expect(q.options.map((o) => o.prompt)).toEqual(["something sexy daytime", "something sexy tonight"]);
    expect(parseIntent(q.options[1]!.prompt, 10)).toMatchObject({ occasion: "evening", vibe: "alluring", question: null });
  });
});

describe("demo engine moods", () => {
  const names = (r: ReturnType<typeof demoSuggest>) =>
    r.outfits[0]!.item_ids.map((id) => demoWardrobe().find((i) => i.id === id)!.metadata!.name!.toLowerCase());

  it("love day is romantic, sexy night is alluring, lazy day has no heels", () => {
    expect(demoSuggest("love day", 3, { hour: 19 }).outfits[0]!.explanation).toMatch(/romantic/);
    const sexy = demoSuggest("something sexy", 3, { hour: 21 });
    expect(sexy.normalized_intent).toMatchObject({ occasion: "evening", vibe: "alluring" });
    expect(names(sexy).join(" ")).toMatch(/slip|pencil|slingback|cami/);
    expect(sexy.outfits[0]!.explanation).not.toMatch(/\b(body|figure|curves|weight)\b/);
    expect(names(demoSuggest("lazy day", 3, { hour: 11 })).join(" ")).not.toMatch(/heel|slingback/);
  });

  it("asks day or night, offers gaps on a shopping day, and keeps a new piece", () => {
    expect(demoSuggest("something sexy", 3, { hour: 9 }).question?.text).toBe("Day or night?");
    expect(demoSuggest("shopping day", 3, { hour: 11 }).offer?.id).toBe("gaps");
    const r = demoSuggest("everyday", 1, { anchorId: "demo_skirt_pleat" });
    expect(r.outfits[0]!.item_ids).toContain("demo_skirt_pleat");
    expect(r.pairing_line).toMatch(/^Nice, your new pleated midi skirt\. It works with your /);
  });
});

describe("the day", () => {
  const items: WardrobeItem[] = [
    { id: "a", category: "top", metadata: { name: "Ivory blouse" }, created_at: "2026-10-01T10:00:00Z" },
    { id: "b", category: "bottom", metadata: { name: "Navy trousers" }, created_at: "2026-08-01T10:00:00Z" },
  ];
  const sets: OutfitSetView[] = [
    { id: "s1", kind: "week", title: "This week", created_at: null, looks: [{ label: "Saturday", item_ids: ["a", "b"], explanation: "" }] },
  ];
  const saturdayEvening = new Date(2026, 9, 3, 19, 30); // Saturday 3 October 2026

  it("finds today's planned look and this week's new pieces", () => {
    expect(planForToday(sets, items, saturdayEvening)?.text).toBe("This week · Saturday: Ivory blouse, Navy trousers");
    expect(newPieces(items, new Date("2026-10-04T10:00:00Z")).map((i) => i.id)).toEqual(["a"]);
    const ctx = dayContext(saturdayEvening, sets, items);
    expect(ctx).toMatchObject({ partOfDay: "evening", plan: expect.stringContaining("Ivory blouse") });
    expect(ctx.today).toMatch(/^Saturday 3 October$/);
  });

  it("orders the home ideas by the moment", () => {
    expect(ideasFor(saturdayEvening).slice(0, 2).map((i) => i.label)).toEqual(["Love day", "Sexy night"]);
    expect(ideasFor(new Date(2026, 9, 5, 8, 0))[0]!.label).toBe("Work day"); // Monday morning
    expect(ideasFor(new Date(2026, 9, 4, 10, 0))[0]!.label).toBe("Shopping day"); // Sunday morning
  });

  it("the persona gets a Today block, then the owned items, then the conversation", () => {
    const ctx = { today: "Saturday 3 October", partOfDay: "evening", plan: "This week · Saturday: Ivory blouse", newPieces: ["Ivory blouse"] };
    expect(contextBlock(ctx)).toBe(
      "Today: Saturday 3 October, evening.\nPlan: This week · Saturday: Ivory blouse.\nNew in the wardrobe: Ivory blouse.",
    );
    const msgs = buildMessages("tonight", [{ id: "a", name: "Ivory blouse" }], [{ role: "user", content: "something sexy" }, { role: "assistant", content: "Day or night?" }], ctx);
    expect(msgs.map((m) => m.role)).toEqual(["system", "system", "user", "assistant", "user"]);
    expect(msgs[0]!.content).toMatch(/^Today:/);
    expect(contextBlock({})).toBeNull();
  });

  it("the demo persona answers moods and mentions new pieces", () => {
    expect(demoReply("something sexy", [], null, 10)).toBe("Day or night?");
    expect(demoReply("love day", [{ id: "a", name: "Ivory blouse" }], null, 19)).toMatch(/romantic/);
    expect(demoReply("work day", [{ id: "a", name: "Ivory blouse" }], { newPieces: ["Ivory blouse"] }, 8)).toMatch(/new ivory blouse/);
  });

  it("the chat route accepts the Today note and the hour", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
    const res = await chat(
      new Request("http://mirror.test/api/stylist/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.7.0.1" },
        body: JSON.stringify({
          prompt: "something sexy",
          hour: 10,
          context: { today: "Saturday 3 October", partOfDay: "morning", newPieces: ["x".repeat(500)], junk: 1 },
          history: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(await res.json()).toMatchObject({ reply: "Day or night?" });
  });
});
