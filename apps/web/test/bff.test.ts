import { afterEach, describe, expect, it, vi } from "vitest";

import { validateToolCall } from "@/lib/server/backend";
import { getConfig, pairingRequired } from "@/lib/server/config";
import { demoCreateTryOn, demoJob, demoSuggest } from "@/lib/server/demo";
import { unwrapToolResult } from "@/lib/server/ollabridge";
import { openSealed, safeEqual, seal } from "@/lib/server/seal";
import { TOOL_CONTRACT } from "@/lib/tools";

afterEach(() => vi.unstubAllEnvs());

describe("session sealing", () => {
  const secret = "x".repeat(40);

  it("round-trips and rejects tampering or a wrong key", async () => {
    const sealed = await seal({ kind: "owner", n: 1 }, secret);
    expect(await openSealed(sealed, secret)).toEqual({ kind: "owner", n: 1 });
    expect(await openSealed(sealed, "y".repeat(40))).toBeNull();
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(await openSealed(flipped, secret)).toBeNull();
    expect(await openSealed("garbage", secret)).toBeNull();
  });

  it("does not leak the payload in plain text", async () => {
    const sealed = await seal({ deviceToken: "super-secret-token" }, secret);
    expect(sealed).not.toContain("super-secret-token");
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("super-secret-token");
  });

  it("compares codes safely", () => {
    expect(safeEqual("123456", "123456")).toBe(true);
    expect(safeEqual("123456", "123457")).toBe(false);
    expect(safeEqual("123456", "1234567")).toBe(false);
  });
});

describe("tool allow-list", () => {
  it("mirrors the shared contract", () => {
    expect(TOOL_CONTRACT.map((t) => t.name)).toContain("hp.smartmirror.style_suggest");
  });

  it("rejects unknown tools and missing required arguments", () => {
    expect(() => validateToolCall("hp.homepilot.shell_exec", {})).toThrow(/Unknown tool/);
    expect(() => validateToolCall("hp.smartmirror.style_suggest", {})).toThrow(/prompt/);
    expect(() => validateToolCall("hp.smartmirror.style_suggest", [])).toThrow(/object/);
    expect(validateToolCall("hp.smartmirror.style_suggest", { prompt: "dinner" })).toEqual({ prompt: "dinner" });
  });
});

describe("backend mode detection", () => {
  it("defaults to demo locally and needs no pairing", () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "");
    vi.stubEnv("SMARTMIRROR_API_URL", "");
    vi.stubEnv("VERCEL", "");
    const config = getConfig();
    expect(config.mode).toBe("demo");
    expect(pairingRequired(config)).toBe(false);
  });

  it("runs the real app on Vercel: pair with OllaBridge Cloud unless demo is asked for", () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "");
    vi.stubEnv("SMARTMIRROR_API_URL", "");
    vi.stubEnv("VERCEL", "1");
    const config = getConfig();
    expect(config.mode).toBe("ollabridge");
    expect(config.ollabridge.baseUrl).toBe("https://app.ollabridge.com");
    expect(pairingRequired(config)).toBe(true);
    vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
    expect(getConfig().mode).toBe("demo");
  });

  it("requires pairing for ollabridge", () => {
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://bridge.example/");
    vi.stubEnv("OLLABRIDGE_TOKEN", "owner-token");
    const config = getConfig();
    expect(config.mode).toBe("ollabridge");
    expect(config.ollabridge.baseUrl).toBe("https://bridge.example");
    expect(pairingRequired(config)).toBe(true);
  });
});

describe("demo backend", () => {
  it("builds complete outfits from the sample wardrobe", () => {
    const result = demoSuggest("black dress for a dinner date", 3);
    expect(result.outfits).toHaveLength(3);
    expect(result.normalized_intent).toMatchObject({ colors: ["black"] });
    for (const o of result.outfits) {
      expect(o.item_ids.length).toBeGreaterThanOrEqual(2);
      expect(o.explanation).not.toMatch(/\bA [aeiou]/);
    }
  });

  it("derives try-on progress from the job id", () => {
    const { job_id } = demoCreateTryOn("demo_outfit_x");
    expect(demoJob(job_id).status).toBe("queued");
    const old = job_id.replace(/demo-job_[0-9a-z]+_/, `demo-job_${(Date.now() - 60_000).toString(36)}_`);
    expect(demoJob(old)).toMatchObject({ status: "succeeded", progress: 1 });
    expect(() => demoJob("job_unknown")).toThrow(/not found/);
  });
});

describe("OllaBridge result unwrapping", () => {
  it("accepts MCP and plain payloads", () => {
    expect(unwrapToolResult({ structuredContent: { a: 1 } })).toEqual({ a: 1 });
    expect(unwrapToolResult({ content: [{ type: "text", text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(unwrapToolResult({ result: { structuredContent: [1] } })).toEqual([1]);
    expect(unwrapToolResult([3])).toEqual([3]);
  });
});
