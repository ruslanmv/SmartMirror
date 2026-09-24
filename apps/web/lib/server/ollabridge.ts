import "server-only";

import type { ServerConfig } from "./config";

/**
 * Server-side client for OllaBridge Cloud's private HomePilot mirror plane.
 * Mirrors integrations/ollabridge/client.py so both stacks speak the same API:
 *
 *   GET  /v1/mirror/nodes
 *   POST /v1/mirror/nodes/{node_id}/jobs
 *   GET  /v1/mirror/jobs/{job_id}?node_id=...
 *   POST /v1/media/upload
 */

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MirrorNode {
  node_id: string;
  node_name?: string | null;
  platform?: string | null;
  online?: boolean;
}

interface MirrorJob {
  job_id?: string;
  id?: string;
  status?: string;
  result?: unknown;
  error?: unknown;
}

const TERMINAL_OK = new Set(["completed", "succeeded", "success", "done"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled", "timeout"]);

export class OllaBridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      const status = res.status === 401 || res.status === 403 ? 401 : 502;
      throw new UpstreamError(`OllaBridge ${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}`, status);
    }
    return (await res.json()) as T;
  }

  listNodes(): Promise<MirrorNode[]> {
    return this.request<MirrorNode[] | { nodes: MirrorNode[] }>("/v1/mirror/nodes").then((r) =>
      Array.isArray(r) ? r : (r.nodes ?? []),
    );
  }

  createJob(nodeId: string, operation: string, params: Record<string, unknown>): Promise<MirrorJob> {
    return this.request<MirrorJob>(`/v1/mirror/nodes/${encodeURIComponent(nodeId)}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, params }),
    });
  }

  getJob(nodeId: string, jobId: string): Promise<MirrorJob> {
    return this.request<MirrorJob>(
      `/v1/mirror/jobs/${encodeURIComponent(jobId)}?node_id=${encodeURIComponent(nodeId)}`,
    );
  }

  async uploadMedia(filename: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    return this.request<Record<string, unknown>>("/v1/media/upload", { method: "POST", body: form });
  }

  /** Pick the configured node, else the first online one. */
  async resolveNode(preferred: string | null | undefined): Promise<MirrorNode> {
    const nodes = await this.listNodes();
    const node = preferred ? nodes.find((n) => n.node_id === preferred) : nodes.find((n) => n.online !== false);
    if (!node) throw new UpstreamError("No HomePilot node is online for this account", 503);
    if (node.online === false) throw new UpstreamError("HomePilot node is offline", 503);
    return node;
  }

  /**
   * Run a SmartMirror MCP tool through HomePilot's allow-listed agentic node
   * job and wait (bounded) for the result. Serverless functions have short
   * lifetimes, so long work (try-on) returns a job id that the UI polls.
   */
  async callTool(
    config: ServerConfig["ollabridge"],
    nodeId: string,
    tool: string,
    args: Record<string, unknown>,
    waitMs = 20_000,
  ): Promise<unknown> {
    const created = await this.createJob(nodeId, config.mcpOperation, {
      server: config.mcpServer,
      tool,
      arguments: args,
    });
    const jobId = created.job_id ?? created.id;
    if (!jobId) throw new UpstreamError("OllaBridge did not return a job id", 502);

    const deadline = Date.now() + waitMs;
    let job: MirrorJob = created;
    let delay = 250;
    while (!TERMINAL_OK.has(String(job.status ?? "").toLowerCase())) {
      if (TERMINAL_FAIL.has(String(job.status ?? "").toLowerCase())) {
        throw new UpstreamError(`SmartMirror tool failed: ${describe(job.error)}`, 502);
      }
      if (Date.now() > deadline) throw new UpstreamError("HomePilot did not answer in time", 504);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.6, 2_000);
      job = await this.getJob(nodeId, jobId);
    }
    return unwrapToolResult(job.result);
  }
}

function describe(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "unknown error";
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
