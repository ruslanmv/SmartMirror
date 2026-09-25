import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string) => jar.set(name, { value }),
    delete: (arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
}));

import { POST as start } from "@/app/api/companion/start/route";
import { POST as status } from "@/app/api/companion/status/route";
import { POST as upload } from "@/app/api/companion/upload/route";
import { POST as media } from "@/app/api/media/route";
import { issueTicket, openTicket } from "@/lib/server/companion";
import { writeSession } from "@/lib/server/session";

const TOKEN = "tok_screen_device";
const IMAGE = "data:image/jpeg;base64," + Buffer.from("\xff\xd8\xff fake jpeg").toString("base64");

function req(body: unknown, ip = "10.3.0.1") {
  return new Request("http://mirror.test/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Fake cloud → HomePilot agentic.invoke that records tool calls and answers them. */
function fakeHome(answers: Record<string, unknown>) {
  const calls: { tool: string; args: Record<string, unknown>; auth: string | null }[] = [];
  let last: { tool: string } = { tool: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const auth = new Headers(init.headers).get("authorization");
      if (path === "/v1/mirror/nodes") return json([{ node_id: "dev_pc", online: true, capabilities: ["homepilot.mirror"] }]);
      if (path.endsWith("/jobs") && init.method === "POST") {
        const body = JSON.parse(init.body as string);
        last = { tool: body.params.tool };
        calls.push({ tool: body.params.tool, args: body.params.arguments, auth });
        return json({ type: "res", ok: true, data: { job_id: "job_1", status: "queued" } }, 202);
      }
      if (path.startsWith("/v1/mirror/jobs/")) {
        return json({ type: "res", ok: true, data: { status: "completed", output: { tool: last.tool, result: answers[last.tool] ?? {} } } });
      }
      return json({}, 404);
    }),
  );
  return calls;
}

function useOllaBridge() {
  vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
  vi.stubEnv("OLLABRIDGE_BASE_URL", "https://ob.test");
  vi.stubEnv("OLLABRIDGE_TOKEN", "");
  vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "q".repeat(40));
}

beforeEach(() => jar.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hand-off ticket", () => {
  it("round-trips, hides the credential and expires", async () => {
    vi.stubEnv("SMARTMIRROR_SESSION_SECRET", "q".repeat(40));
    const t = await issueTicket("cap_1", { v: 1, kind: "device", deviceToken: TOKEN, iat: 0, exp: 0 });
    expect(t).not.toContain(TOKEN);
    const opened = await openTicket(t);
    expect(opened?.sid).toBe("cap_1");
    expect(opened?.session).toMatchObject({ kind: "device", deviceToken: TOKEN, ticket: true });
    expect(await openTicket(t.slice(0, -3) + "AAA")).toBeNull();
    expect(await openTicket(42)).toBeNull();

    vi.useFakeTimers({ now: Date.now() + 11 * 60 * 1000, toFake: ["Date"] });
    expect(await openTicket(t)).toBeNull();
  });
});

describe("phone → screen hand-off (ollabridge)", () => {
  it("the screen starts a session and the phone uploads with only the ticket", async () => {
    useOllaBridge();
    await writeSession({ kind: "device", deviceToken: TOKEN });
    const calls = fakeHome({
      "hp.smartmirror.capture_session_create": { session_id: "cap_" + "a".repeat(32), expires_at: "2026-09-24T10:10:00Z" },
      "hp.smartmirror.capture_upload": { asset_id: "asset_9" },
      "hp.smartmirror.capture_session_complete": { status: "received" },
      "hp.smartmirror.capture_session_get": { status: "received", preview_url: "data:image/jpeg;base64,AAA" },
    });

    const started = await (await start(req({ purpose: "body" }))).json();
    expect(started).toMatchObject({ mode: "remote", code: "AAAAAA" });
    expect(JSON.stringify(started)).not.toContain(TOKEN);

    jar.clear(); // the phone has no cookie
    const res = await upload(req({ ticket: started.ticket, image: IMAGE }, "10.3.0.2"));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.tool)).toEqual([
      "hp.smartmirror.capture_session_create",
      "hp.smartmirror.capture_upload",
      "hp.smartmirror.capture_session_complete",
    ]);
    expect(calls[1]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(calls[1]!.args).toMatchObject({ image: IMAGE, purpose: "body" });
    expect(calls[2]!.args).toMatchObject({ session_id: started.sessionId, asset_id: "asset_9" });
    expect(jar.size).toBe(0); // a ticket never becomes a cookie

    await writeSession({ kind: "device", deviceToken: TOKEN });
    const st = await (await status(req({ sessionId: started.sessionId }))).json();
    expect(st).toMatchObject({ status: "received", preview_url: "data:image/jpeg;base64,AAA" });
  });

  it("refuses bad tickets and images", async () => {
    useOllaBridge();
    fakeHome({});
    expect((await upload(req({ ticket: "nope", image: IMAGE }, "10.3.0.3"))).status).toBe(401);
    const t = await issueTicket("cap_1", null);
    expect((await upload(req({ ticket: t, image: "https://x/y.jpg" }, "10.3.0.4"))).status).toBe(400);
    expect((await status(req({ sessionId: "../../x" }))).status).toBe(400);
  });

  it("demo mode keeps the same-browser channel", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
    expect(await (await start(req({}))).json()).toEqual({ mode: "local" });
  });
});

describe("/api/media", () => {
  it("stores body photos on the owner's PC via capture_upload", async () => {
    useOllaBridge();
    await writeSession({ kind: "device", deviceToken: TOKEN });
    const calls = fakeHome({ "hp.smartmirror.capture_upload": { asset_id: "asset_5", expires_at: "2026-09-25T10:00:00Z" } });
    const res = await media(req({ dataUrl: IMAGE }));
    expect(await res.json()).toEqual({ ref: "asset_5", stored: true, expiresAt: "2026-09-25T10:00:00Z" });
    expect(calls[0]).toMatchObject({ tool: "hp.smartmirror.capture_upload", args: { purpose: "body" } });
    // no cloud media upload any more
    const urls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => u);
    expect(urls.some((u) => u.includes("/v1/media/upload"))).toBe(false);
  });

  it("rejects oversize images", async () => {
    useOllaBridge();
    await writeSession({ kind: "device", deviceToken: TOKEN });
    const big = "data:image/jpeg;base64," + "A".repeat(1_300_000);
    expect((await media(req({ dataUrl: big }))).status).toBe(413);
  });
});

describe("closet scan (garment tickets)", () => {
  it("each phone photo becomes a draft garment; the session stays open", async () => {
    useOllaBridge();
    await writeSession({ kind: "device", deviceToken: TOKEN });
    const calls = fakeHome({
      "hp.smartmirror.capture_session_create": { session_id: "cap_" + "b".repeat(32), expires_at: "x" },
      "hp.smartmirror.wardrobe_ingest": { id: "garment_1", status: "draft" },
    });
    const started = await (await start(req({ purpose: "garment" }))).json();
    expect(started.purpose).toBe("garment");
    jar.clear();
    for (const ip of ["10.4.0.1", "10.4.0.1"]) {
      const res = await upload(req({ ticket: started.ticket, image: IMAGE }, ip));
      expect(await res.json()).toEqual({ ok: true, itemId: "garment_1" });
    }
    expect(calls.map((c) => c.tool)).toEqual([
      "hp.smartmirror.capture_session_create",
      "hp.smartmirror.wardrobe_ingest",
      "hp.smartmirror.wardrobe_ingest",
    ]);
  });
});
