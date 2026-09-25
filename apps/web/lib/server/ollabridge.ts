import "server-only";

import type { ServerConfig } from "./config";
import { USER_AGENT } from "./pairing";

/**
 * Server-side client for OllaBridge Cloud's private HomePilot mirror plane
 * (Plane B). Tool calls travel
 *
 *   BFF → OllaBridge Cloud  POST /v1/mirror/nodes/{node}/jobs     (owner-scoped)
 *       → OllaBridge Local  homepilot.mirror.job.create           (OL-1)
 *       → HomePilot         POST /v1/node/jobs  agentic.invoke     (HP-1, allow-listed)
 *       → SmartMirror MCP   hp.smartmirror.*
 *
 * Endpoints used: GET /v1/mirror/nodes, GET /v1/mirror/nodes/{id}/manifest,
 * POST /v1/mirror/nodes/{id}/jobs, GET /v1/mirror/jobs/{id}?node_id=…,
 * POST /v1/media/upload.
 */

export type UpstreamCode =
  | "upstream"
  | "node_offline"
  | "tool_not_allowed"
  | "capability_unavailable"
  | "timeout"
  | "rate_limited";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: UpstreamCode = "upstream",
  ) {
    super(message);
  }
}

export interface MirrorNode {
  node_id: string;
  node_name?: string | null;
  platform?: string | null;
  online?: boolean;
  /** OllaBridge Cloud OB-4: what the device advertised, e.g. "homepilot.mirror". */
  capabilities?: string[];
}

interface MirrorJob {
  job_id?: string;
  id?: string;
  status?: string;
  /** HomePilot node jobs report their payload as `output`. */
  output?: unknown;
  result?: unknown;
  error?: unknown;
}

const TERMINAL_OK = new Set(["completed", "succeeded", "success", "done"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled", "timeout"]);
export const MIRROR_CAPABILITY = "homepilot.mirror";
export const AGENTIC_OPERATION = "agentic.invoke";

/**
 * OllaBridge Cloud returns the relay envelope as-is:
 * {type: "res", ok, data | error}. Unwrap it, or pass plain bodies through.
 */
export function unwrapRelay<T>(body: unknown): T {
  if (body && typeof body === "object" && (body as { type?: unknown }).type === "res" && "ok" in body) {
    const r = body as { ok: boolean; data?: unknown; error?: unknown };
    if (!r.ok) throw jobError(describe(r.error));
    return r.data as T;
  }
  return body as T;
}

/** Map HomePilot / OllaBridge failure text to a clear, actionable error. */
export function jobError(text: string): UpstreamError {
  if (/TOOL_NOT_ALLOWED/.test(text)) {
    return new UpstreamError(
      "Your HomePilot does not allow this SmartMirror tool. Add hp.smartmirror.* to HOMEPILOT_MIRROR_ALLOWED_TOOLS.",
      403,
      "tool_not_allowed",
    );
  }
  if (/Unsupported operation: homepilot\.mirror/.test(text)) {
    return new UpstreamError(
      "OllaBridge on your PC does not relay SmartMirror requests yet. Update it and set HOMEPILOT_MIRROR_RELAY_ENABLED=true.",
      503,
      "capability_unavailable",
    );
  }
  if (/RATE_LIMITED/.test(text)) {
    return new UpstreamError("Too many requests to your HomePilot. Wait a minute and try again.", 429, "rate_limited");
  }
  if (/CAPABILITY_UNAVAILABLE: shopping/.test(text)) {
    return new UpstreamError(
      "Shopping suggestions are off on your PC. Set SMARTMIRROR_SHOPPING=linkout for SmartMirror to turn them on.",
      503,
      "capability_unavailable",
    );
  }
  if (/CAPABILITY_UNAVAILABLE|unknown_operation|node_jobs_disabled/.test(text)) {
    return new UpstreamError(
      "SmartMirror tools are turned off on your HomePilot. Set HOMEPILOT_MIRROR_JOBS_ENABLED and HOMEPILOT_MIRROR_MCP_ENABLED to true.",
      503,
      "capability_unavailable",
    );
  }
  if (/homepilot_unreachable|offline/i.test(text)) {
    return new UpstreamError("Your HomePilot PC is offline", 503, "node_offline");
  }
  return new UpstreamError(`SmartMirror tool failed: ${text.slice(0, 200)}`, 502);
}

export class OllaBridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    }).catch((err: unknown) => {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new UpstreamError(timedOut ? "OllaBridge did not answer in time" : "OllaBridge is unreachable", timedOut ? 504 : 503, timedOut ? "timeout" : "upstream");
    });
    if (!res.ok) {
      const route = `${init.method ?? "GET"} ${path.split("?")[0]}`;
      if (res.status === 401 || res.status === 403) throw new UpstreamError(`OllaBridge ${route} → ${res.status}`, 401);
      const detail = await res.json().catch(() => null);
      const text = JSON.stringify(detail ?? "");
      if (res.status === 409 || /node_offline/.test(text)) throw new UpstreamError("Your HomePilot PC is offline", 503, "node_offline");
      if (res.status === 404 && path.startsWith("/v1/mirror/nodes") && !path.includes("/jobs/")) {
        throw new UpstreamError(
          /Node not found/.test(text)
            ? "That HomePilot node is no longer paired with your account"
            : "The HomePilot mirror is not enabled on OllaBridge Cloud (HOMEPILOT_MIRROR_ENABLED).",
          503,
          "capability_unavailable",
        );
      }
      if (/relay_failed/.test(text)) throw jobError(text);
      throw new UpstreamError(`OllaBridge ${route} → ${res.status}`, 502);
    }
    return (await res.json()) as T;
  }

  listNodes(): Promise<MirrorNode[]> {
    return this.request<MirrorNode[] | { nodes: MirrorNode[] }>("/v1/mirror/nodes").then((r) =>
      Array.isArray(r) ? r : (r.nodes ?? []),
    );
  }

  async manifest(nodeId: string): Promise<Record<string, unknown> | null> {
    const body = await this.request<unknown>(`/v1/mirror/nodes/${encodeURIComponent(nodeId)}/manifest`).catch(() => null);
    if (!body) return null;
    try {
      return unwrapRelay<Record<string, unknown>>(body);
    } catch {
      return null;
    }
  }

  async createJob(nodeId: string, operation: string, params: Record<string, unknown>, resourceUri?: string): Promise<MirrorJob> {
    const body = await this.request<unknown>(`/v1/mirror/nodes/${encodeURIComponent(nodeId)}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, params, ...(resourceUri ? { resource_uri: resourceUri } : {}) }),
    });
    return unwrapRelay<MirrorJob>(body);
  }

  async getJob(nodeId: string, jobId: string): Promise<MirrorJob> {
    const body = await this.request<unknown>(
      `/v1/mirror/jobs/${encodeURIComponent(jobId)}?node_id=${encodeURIComponent(nodeId)}`,
    );
    return unwrapRelay<MirrorJob>(body);
  }

  async uploadMedia(filename: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    return this.request<Record<string, unknown>>("/v1/media/upload", { method: "POST", body: form });
  }

  /**
   * Pick the HomePilot node: the configured/remembered one, else an online
   * node advertising "homepilot.mirror" (OB-4), else the first online node
   * whose manifest offers agentic.invoke. Never this screen's own device.
   */
  async resolveNode(preferred: string | null | undefined, selfDeviceId?: string | null): Promise<MirrorNode> {
    const nodes = (await this.listNodes()).filter((n) => n.node_id !== selfDeviceId);
    if (preferred) {
      const node = nodes.find((n) => n.node_id === preferred);
      if (node && node.online !== false) return node;
      if (node) throw new UpstreamError("Your HomePilot PC is offline", 503, "node_offline");
    }
    const online = nodes.filter((n) => n.online !== false);
    const advertised = online.find((n) => n.capabilities?.includes(MIRROR_CAPABILITY));
    if (advertised) return advertised;
    for (const node of online.filter((n) => !n.capabilities).slice(0, 3)) {
      const caps = (await this.manifest(node.node_id))?.capabilities;
      if (Array.isArray(caps) && caps.includes(AGENTIC_OPERATION)) return node;
    }
    if (online.length === 1 && !online[0]!.capabilities) return online[0]!;
    throw new UpstreamError(
      nodes.length ? "No HomePilot PC with SmartMirror tools is online" : "No HomePilot node is paired with this account",
      503,
      "node_offline",
    );
  }

  /**
   * Run a SmartMirror MCP tool through HomePilot's allow-listed agentic.invoke
   * node job and wait (bounded) for the result. Serverless functions have short
   * lifetimes, so long work (try-on) returns a job id that the UI polls.
   */
  async callTool(
    config: ServerConfig["ollabridge"],
    nodeId: string,
    tool: string,
    args: Record<string, unknown>,
    waitMs = 20_000,
  ): Promise<unknown> {
    const params =
      config.mcpOperation === AGENTIC_OPERATION
        ? { tool, arguments: args }
        : { server: config.mcpServer, tool, arguments: args }; // legacy operation shape
    // A call carrying an idempotency key is safe to submit twice: the PC
    // returns the first result. Retry once when the submit itself was lost.
    const created = await this.createJob(nodeId, config.mcpOperation, params).catch(async (err: unknown) => {
      const meta = args._meta as { idempotency_key?: string } | undefined;
      const transient = err instanceof UpstreamError && (err.code === "timeout" || (err.code === "upstream" && err.status >= 502));
      if (!meta?.idempotency_key || !transient) throw err;
      await new Promise((r) => setTimeout(r, 400));
      return this.createJob(nodeId, config.mcpOperation, params);
    });
    const jobId = created.job_id ?? created.id;
    if (!jobId) throw new UpstreamError("OllaBridge did not return a job id", 502);

    const deadline = Date.now() + waitMs;
    let job: MirrorJob = created;
    let delay = 250;
    while (!TERMINAL_OK.has(String(job.status ?? "").toLowerCase())) {
      if (TERMINAL_FAIL.has(String(job.status ?? "").toLowerCase())) {
        // HomePilot marks a job failed a moment before it records the reason.
        if (!job.error) {
          await new Promise((r) => setTimeout(r, 150));
          job = await this.getJob(nodeId, jobId);
        }
        throw jobError(describe(job.error));
      }
      if (Date.now() > deadline) throw new UpstreamError("HomePilot did not answer in time", 504, "timeout");
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.6, 2_000);
      job = await this.getJob(nodeId, jobId);
    }
    const out = job.output ?? job.result;
    // agentic.invoke returns {tool, result} with the tool's payload already
    // unwrapped; that payload may itself contain a "result" (e.g. job_get).
    if (out && typeof out === "object" && "tool" in out && "result" in out) return (out as { result: unknown }).result;
    return unwrapToolResult(out);
  }
}

function describe(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return err ? JSON.stringify(err) : "unknown error";
}

/** Accept MCP `tools/call` results as well as already-unwrapped payloads. */
export function unwrapToolResult(result: unknown): unknown {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if ("structuredContent" in r) return r.structuredContent;
    if ("result" in r && r.result && typeof r.result === "object") return unwrapToolResult(r.result);
    if (Array.isArray(r.content)) {
      const text = (r.content as Array<{ type?: string; text?: string }>).find((c) => c.type === "text")?.text;
      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }
  return result;
}
