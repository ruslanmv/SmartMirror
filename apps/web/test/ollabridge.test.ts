import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string) => jar.set(name, { value }),
    delete: (arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
}));

import { callTool } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import { OllaBridgeClient, UpstreamError, jobError, unwrapRelay } from "@/lib/server/ollabridge";
import { readSession, writeSession } from "@/lib/server/session";

const BASE = "https://ob.test";
const TOKEN = "tok_device";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const envelope = (data: unknown) => ({ type: "res", id: "mir_1", ok: true, data });

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A fake OllaBridge Cloud mirror plane in front of a fake HomePilot. */
function fakeCloud(opts: {
  nodes: unknown[];
  manifest?: Record<string, unknown>;
  job?: (params: Record<string, unknown>) => { status: string; output?: unknown; error?: string };
}) {
  const calls: Call[] = [];
  let created: Record<string, unknown> = {};
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body as string) : null;
    calls.push({ method: init.method ?? "GET", path: u.pathname, body });
    if (u.pathname === "/v1/mirror/nodes") return json(opts.nodes);
    if (u.pathname.endsWith("/manifest")) return json(envelope(opts.manifest ?? {}));
    if (u.pathname.endsWith("/jobs") && init.method === "POST") {
      created = body.params;
      return json({ ...envelope({ job_id: "job_1", status: "queued", operation: body.operation }), node_id: "x" }, 202);
    }
    if (u.pathname.startsWith("/v1/mirror/jobs/")) {
      return json(envelope({ job_id: "job_1", ...(opts.job?.(created) ?? { status: "completed", output: {} }) }));
    }
    return json({ detail: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const config = () => getConfig().ollabridge;

beforeEach(() => {
  jar.clear();
  vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
  vi.stubEnv("OLLABRIDGE_BASE_URL", BASE);
  vi.stubEnv("OLLABRIDGE_TOKEN", "");
  vi.stubEnv("OLLABRIDGE_NODE_ID", "");
  vi.stubEnv("OLLABRIDGE_MCP_OPERATION", "");
  vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "z".repeat(40));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("relay envelope and errors", () => {
  it("unwraps OllaBridge relay envelopes and passes plain bodies through", () => {
    expect(unwrapRelay(envelope({ a: 1 }))).toEqual({ a: 1 });
    expect(unwrapRelay({ job_id: "j" })).toEqual({ job_id: "j" });
    expect(() => unwrapRelay({ type: "res", ok: false, error: "homepilot_http_404: node_jobs_disabled" })).toThrow(
      /turned off on your HomePilot/,
    );
  });

  it("maps HomePilot and OllaBridge failures to actionable codes", () => {
    const code = (text: string) => jobError(text).code;
    expect(code("ToolNotAllowed: TOOL_NOT_ALLOWED: hp.x")).toBe("tool_not_allowed");
    expect(code("RuntimeError: CAPABILITY_UNAVAILABLE: agentic.invoke is disabled")).toBe("capability_unavailable");
    expect(code("homepilot_http_400: unknown_operation")).toBe("capability_unavailable");
    expect(code("Unsupported operation: homepilot.mirror.job.create")).toBe("capability_unavailable");
    expect(code("homepilot_unreachable: ConnectError")).toBe("node_offline");
    expect(code("RuntimeError: TOOL_FAILED: the tool did not return a result")).toBe("upstream");
    expect(jobError("TOOL_NOT_ALLOWED").status).toBe(403);
  });

  it("defaults to HomePilot's agentic.invoke operation", () => {
    expect(config().mcpOperation).toBe("agentic.invoke");
  });
});

describe("node selection", () => {
  it("skips this screen and phones, picks the node advertising homepilot.mirror", async () => {
    fakeCloud({
      nodes: [
        { node_id: "dev_self", node_name: "SmartMirror", online: true },
        { node_id: "dev_phone", node_name: "Phone", online: true, capabilities: ["chat"] },
        { node_id: "dev_pc", node_name: "Home PC", online: true, capabilities: ["chat", "homepilot.mirror"] },
      ],
    });
    const node = await new OllaBridgeClient(BASE, TOKEN).resolveNode(null, "dev_self");
    expect(node.node_id).toBe("dev_pc");
  });

  it("falls back to probing manifests on older clouds without capabilities", async () => {
    const calls = fakeCloud({
      nodes: [
        { node_id: "dev_a", online: true },
        { node_id: "dev_b", online: true },
      ],
      manifest: { capabilities: ["chat.completions", "agentic.invoke"] },
    });
    const node = await new OllaBridgeClient(BASE, TOKEN).resolveNode(undefined);
    expect(node.node_id).toBe("dev_a");
    expect(calls.some((c) => c.path === "/v1/mirror/nodes/dev_a/manifest")).toBe(true);
  });

  it("reports an offline preferred node and an empty account clearly", async () => {
    fakeCloud({ nodes: [{ node_id: "dev_pc", online: false, capabilities: ["homepilot.mirror"] }] });
    await expect(new OllaBridgeClient(BASE, TOKEN).resolveNode("dev_pc")).rejects.toMatchObject({ code: "node_offline" });
    fakeCloud({ nodes: [] });
    await expect(new OllaBridgeClient(BASE, TOKEN).resolveNode(null)).rejects.toThrow(/No HomePilot node is paired/);
  });
});

describe("tool calls through agentic.invoke", () => {
  it("creates an agentic.invoke job and returns the tool payload", async () => {
    const calls = fakeCloud({
      nodes: [{ node_id: "dev_pc", online: true, capabilities: ["homepilot.mirror"] }],
      job: (params) => ({ status: "completed", output: { tool: params.tool, result: [{ id: "w1", category: "dress" }] } }),
    });
    const result = await new OllaBridgeClient(BASE, TOKEN).callTool(config(), "dev_pc", "hp.smartmirror.wardrobe_list", {
      profile_id: "p",
    });
    expect(result).toEqual([{ id: "w1", category: "dress" }]);
    const create = calls.find((c) => c.method === "POST" && c.path === "/v1/mirror/nodes/dev_pc/jobs")!;
    expect(create.body).toEqual({
      operation: "agentic.invoke",
      params: { tool: "hp.smartmirror.wardrobe_list", arguments: { profile_id: "p" } },
    });
  });

  it("keeps the legacy operation shape when configured", async () => {
    vi.stubEnv("OLLABRIDGE_MCP_OPERATION", "mcp.tools_call");
    const calls = fakeCloud({ nodes: [], job: () => ({ status: "completed", output: { structuredContent: { ok: 1 } } }) });
    await new OllaBridgeClient(BASE, TOKEN).callTool(config(), "dev_pc", "hp.smartmirror.job_get", { job_id: "j" });
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      operation: "mcp.tools_call",
      params: { server: "smartmirror", tool: "hp.smartmirror.job_get" },
    });
  });

  it("surfaces a disallowed tool as tool_not_allowed", async () => {
    fakeCloud({ nodes: [], job: () => ({ status: "failed", error: "ToolNotAllowed: TOOL_NOT_ALLOWED: hp.smartmirror.x" }) });
    const err = await new OllaBridgeClient(BASE, TOKEN)
      .callTool(config(), "dev_pc", "hp.smartmirror.x", {})
      .catch((e: UpstreamError) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe("tool_not_allowed");
  });

  it("the BFF remembers the chosen HomePilot node in the session", async () => {
    await writeSession({ kind: "device", deviceToken: TOKEN, deviceId: "dev_self" });
    fakeCloud({
      nodes: [
        { node_id: "dev_self", online: true },
        { node_id: "dev_pc", online: true, capabilities: ["homepilot.mirror"] },
      ],
      job: (params) => ({ status: "completed", output: { tool: params.tool, result: { outfits: [] } } }),
    });
    const result = await callTool("hp.smartmirror.style_suggest", { prompt: "dinner" });
    expect(result).toEqual({ outfits: [] });
    expect((await readSession())?.nodeId).toBe("dev_pc");
    expect((await readSession())?.deviceToken).toBe(TOKEN);
  });
});

describe("job failure race", () => {
  it("re-reads a failed job whose reason is not recorded yet", async () => {
    let polls = 0;
    fakeCloud({
      nodes: [],
      job: () => {
        polls += 1;
        return polls === 1 ? { status: "failed", error: "" } : { status: "failed", error: "ToolNotAllowed: TOOL_NOT_ALLOWED: hp.x" };
      },
    });
    const err = await new OllaBridgeClient(BASE, TOKEN).callTool(config(), "dev_pc", "hp.x", {}).catch((e: UpstreamError) => e);
    expect((err as UpstreamError).code).toBe("tool_not_allowed");
    expect(polls).toBe(2);
  });
});

describe("payloads that contain their own result field", () => {
  it("returns a job_get payload intact", async () => {
    const payload = { id: "job_9", status: "succeeded", progress: 1, result: { preview_url: "data:image/jpeg;base64,AA" } };
    fakeCloud({ nodes: [], job: (params) => ({ status: "completed", output: { tool: params.tool, result: payload } }) });
    const got = await new OllaBridgeClient(BASE, TOKEN).callTool(config(), "dev_pc", "hp.smartmirror.job_get", { job_id: "job_9" });
    expect(got).toEqual(payload);
  });
});
