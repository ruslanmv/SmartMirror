import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string) => jar.set(name, { value }),
    delete: (arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
}));

import { POST as toolRoute } from "@/app/api/tools/[tool]/route";
import { callTool, toErrorResponse } from "@/lib/server/backend";
import { jobError } from "@/lib/server/ollabridge";
import { writeSession } from "@/lib/server/session";
import { TOOLS } from "@/lib/tools";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Fake cloud whose job submit can fail a number of times first. */
function fakeCloud({ failSubmits = 0, error }: { failSubmits?: number; error?: string } = {}) {
  const submits: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/v1/mirror/nodes") return json([{ node_id: "dev_pc", online: true, capabilities: ["homepilot.mirror"] }]);
      if (path.endsWith("/jobs") && init.method === "POST") {
        submits.push(JSON.parse(init.body as string).params);
        if (submits.length <= failSubmits) return json({ detail: "bad gateway" }, 502);
        return json({ type: "res", ok: true, data: { job_id: "job_1", status: "queued" } }, 202);
      }
      if (path.startsWith("/v1/mirror/jobs/")) {
        return error
          ? json({ type: "res", ok: true, data: { status: "failed", error } })
          : json({ type: "res", ok: true, data: { status: "completed", output: { tool: "x", result: { ok: true } } } });
      }
      return json({}, 404);
    }),
  );
  return submits;
}

async function paired() {
  vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
  vi.stubEnv("OLLABRIDGE_BASE_URL", "https://ob.test");
  vi.stubEnv("OLLABRIDGE_TOKEN", "");
  vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "h".repeat(40));
  await writeSession({ kind: "device", deviceToken: "tok_h", nodeId: "dev_pc" });
}

beforeEach(() => jar.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("trace ids and idempotency keys", () => {
  it("every relayed call carries a fresh trace id and key; the browser cannot set them", async () => {
    await paired();
    const submits = fakeCloud();
    await callTool(TOOLS.wardrobeList, { _meta: { trace_id: "evil", idempotency_key: "evil" } });
    await callTool(TOOLS.wardrobeList, {});
    const metas = submits.map((p) => (p.arguments as { _meta: { trace_id: string; idempotency_key: string } })._meta);
    expect(metas[0]!.trace_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(metas[0]!.trace_id).not.toBe("evil");
    expect(metas[0]!.idempotency_key).not.toBe("evil");
    expect(metas[1]!.trace_id).not.toBe(metas[0]!.trace_id);
  });

  it("retries a lost submit once with the same idempotency key", async () => {
    await paired();
    const submits = fakeCloud({ failSubmits: 1 });
    expect(await callTool(TOOLS.wardrobeAdd, { category: "top" })).toEqual({ ok: true });
    expect(submits).toHaveLength(2);
    expect(submits[1]).toEqual(submits[0]);
  });

  it("gives up after one retry and reports the trace id", async () => {
    await paired();
    fakeCloud({ failSubmits: 5 });
    const err = await callTool(TOOLS.wardrobeAdd, { category: "top" }).catch((e: unknown) => e);
    const body = await toErrorResponse(err).json();
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("error mapping", () => {
  it("names rate limits and switched-off shopping precisely", () => {
    expect(jobError("TOOL_FAILED: RATE_LIMITED: too many try-on requests")).toMatchObject({ status: 429, code: "rate_limited" });
    expect(jobError("CAPABILITY_UNAVAILABLE: shopping suggestions are off (SMARTMIRROR_SHOPPING=linkout)").message).toMatch(
      /Shopping suggestions are off/,
    );
    expect(jobError("CAPABILITY_UNAVAILABLE: agentic.invoke is disabled").message).toMatch(/HOMEPILOT_MIRROR_MCP_ENABLED/);
  });

  it("a PC-side rate limit reaches the browser as 429", async () => {
    await paired();
    fakeCloud({ error: "TOOL_FAILED: RATE_LIMITED: too many try on requests" });
    const res = toErrorResponse(await callTool(TOOLS.styleSuggest, { prompt: "x" }).catch((e: unknown) => e));
    expect(res.status).toBe(429);
  });
});

describe("/api/tools rate limit", () => {
  it("allows a burst of ordinary calls but only a few expensive ones", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
    const call = (tool: string, body: unknown) =>
      toolRoute(
        new Request(`http://mirror.test/api/tools/${tool}`, {
          method: "POST",
          headers: { "x-forwarded-for": "10.9.0.1" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ tool }) } as never,
      );
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await call(TOOLS.setCreate, { kind: "trip", days: 1 })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await call(TOOLS.wardrobeList, {})).status).toBe(200);
  });
});
