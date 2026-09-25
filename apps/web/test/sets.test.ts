import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

import { callTool, validateToolCall } from "@/lib/server/backend";
import { demoSuggest } from "@/lib/server/demo";
import { TOOLS, type OutfitSetView, type ShopOffer } from "@/lib/tools";

afterEach(() => vi.unstubAllEnvs());

function demoMode() {
  vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
}

describe("outfit sets (demo)", () => {
  it("plans a week with weekday labels, lists it and deletes it", async () => {
    demoMode();
    const week = (await callTool(TOOLS.setCreate, { kind: "week", days: 5, prompt: "office" })) as OutfitSetView;
    expect(week.looks.map((l) => l.label)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect(week.looks.every((l) => l.item_ids.length >= 2)).toBe(true);

    const trip = (await callTool(TOOLS.setCreate, { kind: "trip", days: 3 })) as OutfitSetView;
    expect(trip.looks[0]!.label).toBe("Day 1");

    const listed = (await callTool(TOOLS.setList, {})) as OutfitSetView[];
    expect(listed.slice(0, 2).map((s) => s.id)).toEqual([trip.id, week.id]);

    await callTool(TOOLS.setDelete, { set_id: week.id });
    expect(((await callTool(TOOLS.setList, {})) as OutfitSetView[]).map((s) => s.id)).not.toContain(week.id);
  });

  it("the contract validates set and shopping arguments", () => {
    expect(() => validateToolCall(TOOLS.setCreate, {})).toThrow(/kind/);
    expect(() => validateToolCall(TOOLS.setDelete, {})).toThrow(/set_id/);
    expect(() => validateToolCall(TOOLS.shopSuggest, {})).toThrow(/category/);
    expect(() => validateToolCall(TOOLS.shopMarkPurchased, {})).toThrow(/candidate_id/);
  });
});

describe("complete the look (demo)", () => {
  it("names pieces the wardrobe does not have", () => {
    expect(demoSuggest("a black scarf for dinner").gaps).toEqual([{ slot: "scarf", category: "scarf", query: "black scarf" }]);
    expect(demoSuggest("sneakers for the weekend").gaps).toEqual([]); // owned
  });

  it("offers a link-out search, never a purchase", async () => {
    demoMode();
    const [offer] = (await callTool(TOOLS.shopSuggest, { category: "scarf", color: "black" })) as ShopOffer[];
    expect(offer!.url).toBe("https://www.amazon.com/s?k=black+scarf");
    expect(offer!.provider).toBe("amazon-linkout");
  });
});
