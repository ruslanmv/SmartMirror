import "server-only";

import { TOOLS, findTool, type HealthReport } from "@/lib/tools";

import { getConfig, pairingRequired, type ServerConfig } from "./config";
import {
  demoAddItem,
  demoConfirm,
  demoCreateTryOn,
  demoIngest,
  demoJob,
  demoRemove,
  demoReview,
  demoSetCreate,
  demoSetDelete,
  demoSetList,
  demoShopSuggest,
  demoSuggest,
  demoWardrobe,
} from "./demo";
import { MIRROR_CAPABILITY, OllaBridgeClient, UpstreamError, unwrapToolResult } from "./ollabridge";
import { SessionConfigError, readSession, writeSession, type SessionData } from "./session";

/**
 * Backend-for-frontend dispatch. The browser calls one allow-listed tool at a
 * time; this module decides where it runs:
 *
 *   demo        → in-process sample data (default for previews)
 *   direct      → SmartMirror /rpc on a reachable host (local development)
 *   ollabridge  → OllaBridge → owner's HomePilot → SmartMirror MCP
 */

export class BffError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Errors leaving callToolAs carry the call's trace id, shown to the user for support. */
function withTrace(err: unknown, traceId: string): unknown {
  if (err && typeof err === "object") (err as { traceId?: string }).traceId = traceId;
  return err;
}

function traceOf(err: unknown): { traceId?: string } {
  const id = err && typeof err === "object" ? (err as { traceId?: unknown }).traceId : undefined;
  return typeof id === "string" ? { traceId: id } : {};
}

export function ollabridgeToken(config: ServerConfig, session: SessionData | null): string {
  if (session?.kind === "device" && session.deviceToken) return session.deviceToken;
  if (session?.kind === "owner" && config.ollabridge.ownerToken) return config.ollabridge.ownerToken;
  throw new BffError("Pair this screen to continue", 401, "pairing_required");
}

/** Remember the HomePilot node this screen uses, so later calls skip discovery. */
async function rememberNode(session: SessionData | null, nodeId: string): Promise<void> {
  if (!session || session.kind !== "device" || session.nodeId === nodeId) return;
  const { v: _v, iat: _iat, exp: _exp, ...rest } = session;
  await writeSession({ ...rest, nodeId }).catch(() => undefined);
}

export async function requireAccess(config: ServerConfig): Promise<SessionData | null> {
  const session = await readSession();
  if (pairingRequired(config) && !session) {
    throw new BffError("Pair this screen to continue", 401, "pairing_required");
  }
  return session;
}

export function validateToolCall(tool: string, args: unknown): Record<string, unknown> {
  const spec = findTool(tool);
  if (!spec) throw new BffError(`Unknown tool: ${tool}`, 404, "unknown_tool");
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new BffError("Tool arguments must be an object", 400, "bad_arguments");
  }
  const record = args as Record<string, unknown>;
  for (const key of spec.required) {
    if (record[key] === undefined || record[key] === null || record[key] === "") {
      throw new BffError(`Missing argument: ${key}`, 400, "bad_arguments");
    }
  }
  return record;
}

export async function callTool(tool: string, rawArgs: unknown): Promise<unknown> {
  const config = getConfig();
  return callToolAs(await requireAccess(config), tool, rawArgs);
}

/**
 * Run a tool for an explicit session. Used by the phone hand-off, whose
 * request carries a sealed, single-session ticket instead of a cookie.
 */
export async function callToolAs(session: SessionData | null, tool: string, rawArgs: unknown): Promise<unknown> {
  // One id names this call on every hop: BFF → OllaBridge → HomePilot → SmartMirror.
  const traceId = crypto.randomUUID();
  const started = Date.now();
  try {
    const result = await dispatch(session, tool, rawArgs, traceId);
    logCall(tool, traceId, started, "ok");
    return result;
  } catch (err) {
    logCall(tool, traceId, started, err instanceof BffError || err instanceof UpstreamError ? err.code : "error");
    throw withTrace(err, traceId);
  }
}

function logCall(tool: string, trace: string, started: number, outcome: string) {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ evt: "tool", tool, trace, ms: Date.now() - started, outcome }));
}

async function dispatch(session: SessionData | null, tool: string, rawArgs: unknown, traceId: string): Promise<unknown> {
  const config = getConfig();
  // `_meta` is reserved for the BFF; a browser cannot set it.
  const { _meta: _ignored, ...args } = validateToolCall(tool, rawArgs);
  if (pairingRequired(config) && !session) throw new BffError("Pair this screen to continue", 401, "pairing_required");
  // The profile is decided server-side; a browser cannot address another profile.
  const scoped = { ...args, profile_id: config.profileId };
  if (tool === TOOLS.jobGet) delete (scoped as Record<string, unknown>).profile_id;

  switch (config.mode) {
    case "demo":
      return callDemo(tool, scoped);
    case "direct":
      return callDirect(config, tool, withMeta(scoped, traceId));
    case "ollabridge": {
      const client = new OllaBridgeClient(config.ollabridge.baseUrl!, ollabridgeToken(config, session));
      const node = await client.resolveNode(session?.nodeId ?? config.ollabridge.nodeId, session?.deviceId);
      if (!session?.ticket) await rememberNode(session, node.node_id);
      return client.callTool(config.ollabridge, node.node_id, tool, withMeta(scoped, traceId));
    }
  }
}

/** Trace id plus an idempotency key, so a retried submit never creates twice. */
function withMeta(args: Record<string, unknown>, traceId: string): Record<string, unknown> {
  return { ...args, _meta: { trace_id: traceId, idempotency_key: crypto.randomUUID() } };
}

function callDemo(tool: string, args: Record<string, unknown>): unknown {
  switch (tool) {
    case TOOLS.wardrobeList:
      return demoWardrobe();
    case TOOLS.wardrobeAdd:
      return demoAddItem(args);
    case TOOLS.styleSuggest:
      return demoSuggest(String(args.prompt), Number(args.limit) || 3);
    case TOOLS.tryonCreate:
      return demoCreateTryOn(String(args.outfit_id));
    case TOOLS.jobGet:
      return demoJob(String(args.job_id));
    case TOOLS.wardrobeIngest:
      return demoIngest(args);
    case TOOLS.wardrobeReview:
      return demoReview();
    case TOOLS.wardrobeConfirm:
      return demoConfirm(args);
    case TOOLS.wardrobeRemove:
      return demoRemove(args);
    case TOOLS.setCreate:
      return demoSetCreate(args);
    case TOOLS.setList:
      return demoSetList();
    case TOOLS.setDelete:
      return demoSetDelete(args);
    case TOOLS.shopSuggest:
      return demoShopSuggest(args);
    case TOOLS.shopMarkPurchased:
      return { id: String(args.candidate_id), purchased: true };
    case TOOLS.profileDelete:
      // Demo data lives in this server process and resets on restart; the
      // screen clears its own photos and looks.
      return { deleted: {} };
    default:
      throw new BffError(`Tool not available in demo mode: ${tool}`, 501, "not_implemented");
  }
}

async function callDirect(config: ServerConfig, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${config.smartmirrorApiUrl}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => {
    throw new UpstreamError("SmartMirror API is unreachable", 503);
  });
  const body = (await res.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null;
  if (!res.ok || !body || body.error) {
    throw new UpstreamError(body?.error?.message ?? `SmartMirror API → ${res.status}`, res.status >= 500 ? 502 : 400);
  }
  return unwrapToolResult(body.result);
}

export async function health(): Promise<HealthReport> {
  const config = getConfig();
  const session = await readSession().catch(() => null);
  const base: HealthReport = {
    backend: config.mode,
    paired: Boolean(session),
    pairingRequired: pairingRequired(config),
    ollabridge: "n/a",
    homepilot: "n/a",
    checkedAt: new Date().toISOString(),
  };

  if (config.mode === "demo") return { ...base, ollabridge: "ok", homepilot: "ok" };

  if (config.mode === "direct") {
    const ok = await fetch(`${config.smartmirrorApiUrl}/health`, { signal: AbortSignal.timeout(4_000), cache: "no-store" })
      .then((r) => r.ok)
      .catch(() => false);
    return { ...base, homepilot: ok ? "ok" : "down" };
  }

  let token: string;
  try {
    token = ollabridgeToken(config, session);
  } catch {
    return base;
  }
  const client = new OllaBridgeClient(config.ollabridge.baseUrl!, token, 5_000);
  try {
    const nodes = (await client.listNodes()).filter((n) => n.node_id !== session?.deviceId);
    const preferred = session?.nodeId ?? config.ollabridge.nodeId;
    const node = preferred
      ? nodes.find((n) => n.node_id === preferred)
      : (nodes.find((n) => n.online !== false && n.capabilities?.includes(MIRROR_CAPABILITY)) ??
        nodes.find((n) => n.online !== false));
    return {
      ...base,
      ollabridge: "ok",
      homepilot: node && node.online !== false ? "ok" : "down",
      node: node ? { id: node.node_id, name: node.node_name } : undefined,
    };
  } catch {
    return { ...base, ollabridge: "down", homepilot: "down" };
  }
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof BffError) {
    return Response.json({ error: err.message, code: err.code, ...traceOf(err) }, { status: err.status });
  }
  if (err instanceof UpstreamError) {
    return Response.json({ error: err.message, code: err.code, ...traceOf(err) }, { status: err.status });
  }
  if (err instanceof SessionConfigError) {
    return Response.json({ error: err.message, code: "misconfigured" }, { status: 500 });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  // Validation errors from the demo backend (e.g. "Job not found").
  if (/required|not found/i.test(message)) return Response.json({ error: message, code: "bad_request", ...traceOf(err) }, { status: 400 });
  console.error("[smartmirror-bff]", err);
  return Response.json({ error: "Unexpected server error", code: "internal", ...traceOf(err) }, { status: 500 });
}
