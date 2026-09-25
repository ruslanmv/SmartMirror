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
  profileDelete: "hp.smartmirror.profile_delete",
  captureUpload: "hp.smartmirror.capture_upload",
  wardrobeIngest: "hp.smartmirror.wardrobe_ingest",
  wardrobeReview: "hp.smartmirror.wardrobe_review",
  wardrobeConfirm: "hp.smartmirror.wardrobe_confirm",
  wardrobeRemove: "hp.smartmirror.wardrobe_remove",
  setCreate: "hp.smartmirror.set_create",
  setList: "hp.smartmirror.set_list",
  setDelete: "hp.smartmirror.set_delete",
  shopSuggest: "hp.smartmirror.shop_suggest",
  shopMarkPurchased: "hp.smartmirror.shop_mark_purchased",
  captureSessionCreate: "hp.smartmirror.capture_session_create",
  captureSessionComplete: "hp.smartmirror.capture_session_complete",
  captureSessionGet: "hp.smartmirror.capture_session_get",
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
  /** What the wardrobe could not fill for this request (stylist v2). */
  gaps?: WardrobeGap[];
}

export interface WardrobeGap {
  slot: string;
  category: string;
  query: string;
}

export interface OutfitSetView {
  id: string;
  kind: "week" | "trip" | "capsule";
  title: string;
  created_at: string | null;
  looks: { label: string; item_ids: string[]; explanation: string }[];
}

export interface ShopOffer {
  id: string;
  title: string;
  url: string;
  provider: string;
  query: string;
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

/** A garment waiting in the review queue, with the PC's suggestions. */
export interface DraftItem {
  id: string;
  image_url: string | null;
  suggested: { category: string | null; subcategory: string | null; color: string | null; pattern: string | null };
  confidence: Record<string, number>;
  alternatives: { category?: string[]; subcategory?: string[]; color?: string[] };
  needs_review: string[];
  categories: string[];
}
