/**
 * Issue #2: the BFF against the published v1 fixtures. A mocked OllaBridge
 * Cloud answers with exactly the files in packages/contracts/v1, so a change to
 * the contract shows up here as well as in HomePilot's and OllaBridge's suites.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string) => jar.set(name, { value }),
    delete: (arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
}));

import { callTool, toErrorResponse } from "@/lib/server/backend";
import { writeSession } from "@/lib/server/session";
import { TOOLS } from "@/lib/tools";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/contracts/v1/${name}`, import.meta.url), "utf8")) as Record<string, any>;

const REQUEST = fixture("agentic-invoke.request.json");
const ENVELOPE = fixture("relay-envelope.json");
const COMPLETED = fixture("agentic-invoke.completed.json");
const FAILED = fixture("agentic-invoke.failed.json");
const ERRORS = fixture("errors.json");

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Mocked mirror plane that answers with the fixtures and records what it received. */
function mirror(job: Record<string, unknown>) {
  const created: Record<string, any>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const { pathname } = new URL(url);
      if (pathname === "/v1/mirror/nodes") return json([{ node_id: ENVELOPE.node_id, online: true, capabilities: ["homepilot.mirror"] }]);
      if (pathname.endsWith("/jobs") && init.method === "POST") {
        created.push(JSON.parse(init.body as string));
        return json(ENVELOPE, 202);
      }
      if (pathname === `/v1/mirror/jobs/${ENVELOPE.data.job_id}`) return json({ ...ENVELOPE, data: job });
      return json({ detail: "not found" }, 404);
    }),
  );
  return created;
}

beforeEach(async () => {
  jar.clear();
  vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
  vi.stubEnv("OLLABRIDGE_BASE_URL", "https://ob.test");
  vi.stubEnv("OLLABRIDGE_TOKEN", "");
  vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "c".repeat(40));
  await writeSession({ kind: "device", deviceToken: "tok_contract" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("agentic.invoke v1 fixtures", () => {
  it("sends the documented request and returns the tool's own result", async () => {
    const created = mirror(COMPLETED);
    const args = REQUEST.params.arguments;
    const result = await callTool(TOOLS.styleSuggest, { prompt: args.prompt, limit: args.limit });

    expect(result).toEqual(COMPLETED.output.result);
    const [body] = created;
    expect(body.operation).toBe(REQUEST.operation);
    expect(body.params.tool).toBe(REQUEST.params.tool);
    expect(Object.keys(body.params.arguments).sort()).toEqual(Object.keys(args).sort());
    expect(Object.keys(body.params.arguments._meta).sort()).toEqual(Object.keys(args._meta).sort());
  });

  it("maps the failed fixture to the documented BFF status", async () => {
    mirror(FAILED);
    const err = await callTool(TOOLS.styleSuggest, { prompt: "x" }).catch((e: unknown) => e);
    const res = toErrorResponse(err);
    expect(res.status).toBe(ERRORS.bff.tool_not_allowed);
    expect((await res.json()).code).toBe("tool_not_allowed");
  });

  it("every documented error code has a BFF mapping or reads as a tool failure", async () => {
    for (const code of Object.keys(ERRORS.codes)) {
      mirror({ ...FAILED, error: `${code}: fixture` });
      const res = toErrorResponse(await callTool(TOOLS.wardrobeList, {}).catch((e: unknown) => e));
      expect([403, 429, 502, 503, 504]).toContain(res.status);
    }
  });
});
