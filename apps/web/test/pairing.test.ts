import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory cookie jar standing in for next/headers.
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
    delete: (arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
}));

import { POST as pairCode } from "@/app/api/session/pair/route";
import { POST as pairPoll } from "@/app/api/session/pair/poll/route";
import { POST as pairStart } from "@/app/api/session/pair/start/route";
import { GET as sessionGet } from "@/app/api/session/route";
import { DEFAULT_OLLABRIDGE_URL, getConfig } from "@/lib/server/config";
import {
  PENDING_COOKIE,
  USER_AGENT,
  clientBlock,
  formatUserCode,
  normalizeUserCode,
  parseDevicePoll,
  parseDeviceStart,
  parsePairResponse,
  platformFor,
} from "@/lib/server/pairing";
import { SESSION_COOKIE } from "@/lib/server/session";
import { APP_VERSION } from "@/lib/version";

const SECRET = "s".repeat(40);
const DEVICE_CODE = "dc_super_secret_device_code";
const TOKEN = "tok_super_secret_device_token";

function useOllaBridge() {
  vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
  vi.stubEnv("OLLABRIDGE_BASE_URL", "https://bridge.example");
  vi.stubEnv("OLLABRIDGE_TOKEN", "");
  vi.stubEnv("SMARTMIRROR_SESSION_SECRET", SECRET);
  vi.stubEnv("SMARTMIRROR_ACCESS_CODE", "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function req(body: unknown = {}, ip = "10.0.0.1"): Request {
  return new Request("http://mirror.test/api/session/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

let ipCounter = 0;
const freshIp = () => `10.1.0.${++ipCounter}`;

beforeEach(() => jar.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pairing helpers", () => {
  it("normalises OllaBridge codes", () => {
    expect(normalizeUserCode("abcd-1234")).toBe("ABCD1234");
    expect(normalizeUserCode(" ABCD 1234 ")).toBe("ABCD1234");
    expect(normalizeUserCode("123456")).toBeNull();
    expect(normalizeUserCode("ABCD123")).toBeNull();
    expect(normalizeUserCode(42)).toBeNull();
    expect(formatUserCode("abcd1234")).toBe("ABCD-1234");
  });

  it("parses both /pair and /device/pair-simple response shapes", () => {
    expect(parsePairResponse({ ok: true, token: "t1", device_id: "d1" })).toEqual({ token: "t1", deviceId: "d1" });
    expect(parsePairResponse({ status: "ok", device_token: "t2", device_id: "d2" })).toEqual({ token: "t2", deviceId: "d2" });
    // /pair refuses with HTTP 200 and ok:false.
    expect(parsePairResponse({ ok: false, error: "Pairing code expired" })).toEqual({ error: "Pairing code expired" });
    expect(parsePairResponse({ status: "error", error: "Invalid pairing code" })).toEqual({ error: "Invalid pairing code" });
    expect(parsePairResponse(null)).toEqual({ error: "That code was not accepted" });
  });

  it("parses device start and poll responses", () => {
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://bridge.example");
    expect(
      parseDeviceStart({ user_code: "ABCD-1234", device_code: "dc", verification_url: "https://x/link", expires_in: 600 }),
    ).toEqual({ userCode: "ABCD-1234", deviceCode: "dc", verificationUrl: "https://x/link", expiresIn: 600 });
    expect(parseDeviceStart({ user_code: "ABCD1234", device_code: "dc", verification_url: "javascript:alert(1)" })).toMatchObject({
      userCode: "ABCD-1234",
      verificationUrl: "https://bridge.example/link",
      expiresIn: 600,
    });
    expect(parseDeviceStart({})).toBeNull();

    expect(parseDevicePoll(200, { status: "pending" })).toEqual({ status: "pending" });
    expect(parseDevicePoll(200, { status: "approved", device_token: "t", device_id: "d" })).toEqual({
      status: "approved",
      token: "t",
      deviceId: "d",
    });
    expect(parseDevicePoll(200, { status: "approved", device_id: "d" })).toEqual({ status: "expired" });
    expect(parseDevicePoll(200, { status: "expired" })).toEqual({ status: "expired" });
    expect(parseDevicePoll(404, { detail: "Invalid device_code" })).toEqual({ status: "expired" });
  });

  it("identifies as SmartMirror", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
    ) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(`smartmirror/${APP_VERSION}`);
    expect(clientBlock("android")).toMatchObject({ name: "SmartMirror", platform: "android" });
    expect(platformFor("echo-shell")).toBe("android");
    expect(platformFor("browser")).toBe("other");
  });
});

describe("config", () => {
  it("uses the OllaBridge Cloud default when the backend is ollabridge", () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "");
    const config = getConfig();
    expect(config.ollabridge.baseUrl).toBe(DEFAULT_OLLABRIDGE_URL);
    expect(config.ollabridge.pairingPath).toBe("/pair");
    expect(config.ollabridge.pairingFlow).toBe("device");
  });

  it("a base URL alone selects ollabridge; nothing configured stays demo", () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "");
    vi.stubEnv("OLLABRIDGE_TOKEN", "");
    vi.stubEnv("SMARTMIRROR_API_URL", "");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://bridge.example");
    expect(getConfig().mode).toBe("ollabridge");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "");
    expect(getConfig().mode).toBe("demo");
    expect(getConfig().ollabridge.baseUrl).toBeNull();
  });

  it("honours OLLABRIDGE_PAIRING_FLOW=code", () => {
    vi.stubEnv("OLLABRIDGE_PAIRING_FLOW", "code");
    expect(getConfig().ollabridge.pairingFlow).toBe("code");
  });
});

describe("TV-style device pairing (ollabridge)", () => {
  it("shows a code, waits, then seals the token into the session", async () => {
    useOllaBridge();
    const calls: { url: string; init: RequestInit }[] = [];
    let pollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/device/start")) {
          return json({ user_code: "WXYZ-4321", device_code: DEVICE_CODE, verification_url: "https://bridge.example/link", expires_in: 600 });
        }
        if (url.endsWith("/device/poll")) {
          pollCount += 1;
          return pollCount === 1 ? json({ status: "pending" }) : json({ status: "approved", device_id: "dev_42", device_token: TOKEN });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const started = await pairStart(req({ deviceName: "Echo Show", runtime: "echo-shell" }, freshIp()));
    const startBody = await started.text();
    expect(started.status).toBe(200);
    expect(JSON.parse(startBody)).toMatchObject({ userCode: "WXYZ-4321", verificationUrl: "https://bridge.example/link", expiresIn: 600 });
    expect(startBody).not.toContain(DEVICE_CODE);
    expect(calls[0]!.url).toBe("https://bridge.example/device/start");
    expect((calls[0]!.init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);

    const pending = jar.get(PENDING_COOKIE)!;
    expect(pending.value).not.toContain(DEVICE_CODE);
    expect(pending.options).toMatchObject({ httpOnly: true, path: "/api/session/pair" });

    const first = await pairPoll();
    expect(await first.json()).toEqual({ status: "pending" });
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    const second = await pairPoll();
    const secondBody = await second.text();
    expect(JSON.parse(secondBody)).toEqual({ status: "approved", kind: "device" });
    expect(secondBody).not.toContain(TOKEN);

    const pollInit = calls.find((c) => c.url.endsWith("/device/poll"))!.init;
    expect(JSON.parse(pollInit.body as string)).toEqual({
      device_code: DEVICE_CODE,
      client: { name: "SmartMirror", version: APP_VERSION, platform: "android", vendor: "ruslanmv" },
    });

    expect(jar.has(PENDING_COOKIE)).toBe(false);
    const session = jar.get(SESSION_COOKIE)!;
    expect(session.options).toMatchObject({ httpOnly: true });
    expect(session.value).not.toContain(TOKEN);

    const status = await (await sessionGet()).json();
    expect(status).toMatchObject({
      backend: "ollabridge",
      paired: true,
      pairing: { device: true, code: "ollabridge", primary: "device", gateway: "bridge.example" },
      session: { kind: "device", deviceId: "dev_42", deviceName: "Echo Show" },
    });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("reports expiry and keeps polling through upstream hiccups", async () => {
    useOllaBridge();
    let mode: "down" | "expired" = "down";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/device/start")) return json({ user_code: "ABCD-1234", device_code: DEVICE_CODE, expires_in: 600 });
        return mode === "down" ? json({ detail: "bad gateway" }, 502) : json({ status: "expired" });
      }),
    );
    await pairStart(req({}, freshIp()));
    const hiccup = await (await pairPoll()).json();
    expect(hiccup.status).toBe("pending");
    expect(hiccup.warning).toBeTruthy();
    expect(jar.has(PENDING_COOKIE)).toBe(true);

    mode = "expired";
    expect(await (await pairPoll()).json()).toEqual({ status: "expired" });
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    // Nothing pending any more.
    expect(await (await pairPoll()).json()).toEqual({ status: "expired" });
  });

  it("surfaces an unreachable gateway on start", async () => {
    useOllaBridge();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    const res = await pairStart(req({}, freshIp()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("upstream");
  });
});

describe("code-entry pairing (3D Avatar style)", () => {
  it("claims the code at /pair with the SmartMirror identity", async () => {
    useOllaBridge();
    const fetchMock = vi.fn(async () => json({ ok: true, token: TOKEN, device_id: "dev_7" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pairCode(req({ code: "abcd-1234", deviceName: "Browser", runtime: "browser" }, freshIp()));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(TOKEN);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bridge.example/pair");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "ABCD1234",
      label: "SmartMirror",
      client: { name: "SmartMirror", version: APP_VERSION, platform: "other", vendor: "ruslanmv" },
    });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });

  it("shows OllaBridge's own reason when it refuses with HTTP 200", async () => {
    useOllaBridge();
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, error: "Pairing code expired" })));
    const res = await pairCode(req({ code: "ABCD1234" }, freshIp()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Pairing code expired", code: "rejected" });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("rejects malformed codes before calling OllaBridge", async () => {
    useOllaBridge();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await pairCode(req({ code: "123456" }, freshIp()));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throttles repeated attempts per client", async () => {
    useOllaBridge();
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, error: "Invalid pairing code" })));
    const ip = freshIp();
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) last = await pairCode(req({ code: "ABCD1234" }, ip));
    expect(last!.status).toBe(429);
  });
});

describe("demo backend", () => {
  beforeEach(() => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "demo");
    vi.stubEnv("SMARTMIRROR_ACCESS_CODE", "");
  });

  it("device flow confirms itself after a few seconds", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T10:00:00Z"), toFake: ["Date"] });
    const started = await (await pairStart(req({}, freshIp()))).json();
    expect(started).toMatchObject({ userCode: "DEMO-2026", demo: true });
    expect(await (await pairPoll()).json()).toEqual({ status: "pending" });
    vi.setSystemTime(new Date("2026-09-24T10:00:10Z"));
    expect(await (await pairPoll()).json()).toEqual({ status: "approved", kind: "demo" });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });

  it("typed codes: 6 digits (legacy) or ABCD-1234", async () => {
    expect((await pairCode(req({ code: "123456" }, freshIp()))).status).toBe(200);
    expect((await pairCode(req({ code: "WXYZ-9876" }, freshIp()))).status).toBe(200);
    expect((await pairCode(req({ code: "12" }, freshIp()))).status).toBe(400);
  });
});

describe("single-owner ollabridge deployment", () => {
  it("keeps unlocking screens with SMARTMIRROR_ACCESS_CODE", async () => {
    vi.stubEnv("SMARTMIRROR_BACKEND", "ollabridge");
    vi.stubEnv("OLLABRIDGE_BASE_URL", "https://bridge.example");
    vi.stubEnv("OLLABRIDGE_TOKEN", "owner-token");
    vi.stubEnv("SMARTMIRROR_ACCESS_CODE", "482910");
    vi.stubEnv("SMARTMIRROR_SESSION_SECRET", SECRET);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const status = await (await sessionGet()).json();
    expect(status.pairing).toMatchObject({ device: false, code: "access", primary: "code" });
    expect((await pairStart(req({}, freshIp()))).status).toBe(501);
    expect((await pairCode(req({ code: "000000" }, freshIp()))).status).toBe(401);
    const ok = await pairCode(req({ code: "482910" }, freshIp()));
    expect(await ok.json()).toEqual({ ok: true, kind: "owner" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
