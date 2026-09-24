import contract from "@smartmirror/contracts/mcp-tools.json";

/**
 * SmartMirror MCP tools the web BFF may call. The list comes from the shared
 * contract the Python backend is tested against, so the browser can never
 * reach a tool the backend does not publish.
 */
export const TOOL_CONTRACT: ReadonlyArray<{ name: string; required: readonly string[] }> = contract.tools;

export const TOOLS = {
  wardrobeList: "hp.smartmirror.wardrobe_list",
  wardrobeAdd: "hp.smartmirror.wardrobe_add",
  styleSuggest: "hp.smartmirror.style_suggest",
  tryonCreate: "hp.smartmirror.tryon_create",
  jobGet: "hp.smartmirror.job_get",
} as const;

export type ToolName = (typeof TOOLS)[keyof typeof TOOLS];

export function findTool(name: string) {
  return TOOL_CONTRACT.find((t) => t.name === name) ?? null;
}

export interface WardrobeItem {
  id: string;
  category: string;
  subcategory?: string | null;
  color?: string | null;
  material?: string | null;
  fit?: string | null;
  length?: string | null;
  metadata?: {
    name?: string;
    image_url?: string;
    [key: string]: unknown;
  };
}

export interface NewWardrobeItem {
  category: string;
  subcategory?: string;
  color?: string;
  material?: string;
  metadata?: { name?: string };
}

export interface OutfitCandidate {
  id: string;
  item_ids: string[];
  score: number;
  explanation: string;
  /** Optional display title (demo backend and future AI enrichment). */
  title?: string;
}

export interface StyleSuggestResult {
  request_id: string;
  normalized_intent: Record<string, unknown>;
  outfits: OutfitCandidate[];
}

export interface TryOnCreated {
  job_id: string;
  status: string;
}

export interface JobStatus {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  progress: number;
  result: {
    preview_url?: string;
    stage?: string;
    [key: string]: unknown;
  };
  error_code?: string | null;
}

export type BackendMode = "demo" | "direct" | "ollabridge";

export interface HealthReport {
  backend: BackendMode;
  paired: boolean;
  pairingRequired: boolean;
  ollabridge: "ok" | "down" | "n/a";
  homepilot: "ok" | "down" | "n/a";
  node?: { id: string; name?: string | null };
  checkedAt: string;
}
