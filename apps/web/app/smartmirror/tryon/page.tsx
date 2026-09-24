"use client";

import { Badge, Button, Icon, Progress, garmentColor } from "@smartmirror/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Mirror } from "@/components/Mirror";
import { SwatchTile, itemName } from "@/components/OutfitCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import { getLooks, getOutfitSession, saveLook } from "@/lib/storage";
import type { JobStatus, OutfitCandidate, WardrobeItem } from "@/lib/tools";
import { useCapture } from "@/lib/use-local";

type Phase = { kind: "idle" } | { kind: "uploading" } | { kind: "running"; job: JobStatus } | { kind: "done"; job: JobStatus } | { kind: "error"; message: string };

export default function TryOnPage() {
  return (
    <Suspense>
      <TryOn />
    </Suspense>
  );
}

function findOutfit(id: string | null): { outfit: OutfitCandidate; items: WardrobeItem[]; prompt?: string } | null {
  if (!id) {
    const session = getOutfitSession();
    const first = session?.outfits[0];
    return first && session ? { outfit: first, items: session.items, prompt: session.prompt } : null;
  }
  const session = getOutfitSession();
  const fromSession = session?.outfits.find((o) => o.id === id);
  if (fromSession && session) return { outfit: fromSession, items: session.items, prompt: session.prompt };
  const look = getLooks().find((l) => l.outfit.id === id);
  return look ? { outfit: look.outfit, items: look.items, prompt: look.prompt } : null;
}

function TryOn() {
  const params = useSearchParams();
  const outfitId = params.get("outfit");
  const router = useRouter();
  const toast = useToast();
  const capture = useCapture();
  const [selection, setSelection] = useState<ReturnType<typeof findOutfit> | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [saved, setSaved] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    setSelection(findOutfit(outfitId));
  }, [outfitId]);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  if (selection === undefined) return null;

  const returnTo = `/smartmirror/tryon${outfitId ? `?outfit=${encodeURIComponent(outfitId)}` : ""}`;

  if (!selection) {
    return (
      <div className="screen">
        <ScreenHeader title="Virtual try-on" />
        <div className="empty">
          <div className="empty__icon">
            <Icon name="wand" />
          </div>
          <p className="empty__title">Pick an outfit first</p>
          <p>Ask your stylist for a few looks, then choose “Try it on”.</p>
          <Link href="/smartmirror/stylist" className="sm-btn sm-btn--primary" data-autofocus>
            Ask stylist
          </Link>
        </div>
      </div>
    );
  }

  const { outfit, items, prompt } = selection;
  const pieces = outfit.item_ids.map((id) => items.find((i) => i.id === id)).filter((i): i is WardrobeItem => Boolean(i));
  const lead = pieces[0];

  const start = async () => {
    if (!capture) return;
    cancelled.current = false;
    setPhase({ kind: "uploading" });
    try {
      const { ref } = await api.uploadCapture(capture.dataUrl);
      const created = await api.createTryOn(outfit.id, ref, prompt ?? "");
      let job: JobStatus = { id: created.job_id, status: created.status, progress: 0, result: {} };
      setPhase({ kind: "running", job });
      const startedAt = Date.now();
      while (!cancelled.current) {
        await new Promise((r) => setTimeout(r, 1200));
        job = await api.job(created.job_id);
        if (job.status === "succeeded") {
          setPhase({ kind: "done", job });
          return;
        }
        if (job.status === "failed") throw new ApiError(tryOnErrorText(job.error_code), 500, "job_failed");
        setPhase({ kind: "running", job });
        // A backend without a try-on worker leaves jobs queued forever.
        if (job.status === "queued" && Date.now() - startedAt > 90_000) {
          throw new ApiError("Your HomePilot accepted the job but no try-on worker picked it up yet.", 504, "queued");
        }
      }
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Try-on failed" });
    }
  };

  const previewUrl = phase.kind === "done" && typeof phase.job.result.preview_url === "string" ? phase.job.result.preview_url : null;
  const isDemo = phase.kind === "done" && !previewUrl;
  const disclaimer = phase.kind === "done" && typeof phase.job.result.disclaimer === "string" ? phase.job.result.disclaimer : null;
  const showing = previewUrl && !showOriginal ? previewUrl : capture?.dataUrl;

  return (
    <div className="screen">
      <ScreenHeader title="Virtual try-on" subtitle={outfit.title ?? "Your selected look"} backHref="/smartmirror/stylist" />
      <div className="tryon">
        <div className="stage__view" style={{ minHeight: 0 }}>
          <Mirror
            imageUrl={showing}
            label={phase.kind === "done" ? "Try-on preview" : "Your photo"}
            caption={
              phase.kind === "done" ? (
                <Badge tone="accent">{isDemo ? "Demo preview" : showOriginal ? "Your photo" : "Try-on preview"}</Badge>
              ) : !capture ? (
                <Badge>No photo yet</Badge>
              ) : undefined
            }
          >
            {phase.kind === "running" || phase.kind === "uploading" ? <div className="scan-line" /> : null}
            {isDemo && (
              <>
                <div className="preview-tint" style={{ background: `linear-gradient(180deg, transparent 20%, ${garmentColor(lead?.color)} 55%, transparent 95%)` }} />
                <div className="preview-overlay">
                  {pieces.slice(0, 4).map((p) => (
                    <SwatchTile key={p.id} item={p} />
                  ))}
                </div>
              </>
            )}
          </Mirror>
        </div>

        <section className="sm-panel tryon__panel" aria-live="polite">
          <p className="sm-eyebrow">The look</p>
          <div className="tryon__items">
            {pieces.map((p) => (
              <div key={p.id} className="tryon__item">
                <SwatchTile item={p} />
                {itemName(p)}
              </div>
            ))}
          </div>

          {!capture ? (
            <>
              <p className="sm-muted">Take a full-length photo so the outfit can be draped on you.</p>
              <Button variant="primary" size="lg" icon="camera" data-autofocus onClick={() => router.push(`/smartmirror/capture?next=${encodeURIComponent(returnTo)}`)}>
                Take photo
              </Button>
            </>
          ) : phase.kind === "idle" ? (
            <>
              <p className="sm-muted">Your photo is sent only to your own HomePilot for rendering. Nothing is kept in the cloud.</p>
              <Button variant="primary" size="lg" icon="wand" data-autofocus onClick={() => void start()}>
                Start try-on
              </Button>
            </>
          ) : phase.kind === "uploading" || phase.kind === "running" ? (
            <div className="tryon__progress">
              <div className="tryon__stage">
                <span>{phase.kind === "uploading" ? "Sending photo to HomePilot" : String(phase.job.result.stage ?? phase.job.status)}</span>
                <span>{phase.kind === "running" ? `${Math.round(phase.job.progress * 100)}%` : ""}</span>
              </div>
              <Progress value={phase.kind === "running" ? phase.job.progress : 0.02} label="Try-on progress" />
              <Button
                variant="ghost"
                onClick={() => {
                  cancelled.current = true;
                  setPhase({ kind: "idle" });
                }}
              >
                Cancel
              </Button>
            </div>
          ) : phase.kind === "done" ? (
            <>
              <p className="sm-muted">
                {isDemo
                  ? "Demo mode shows a styled overlay. Connect your HomePilot to render a real try-on."
                  : `Rendered on your HomePilot. ${disclaimer ?? "AI style preview — not a fit guarantee"}.`}
              </p>
              <div className="outfit__actions">
                <Button
                  variant="primary"
                  icon={saved ? "check" : "plus"}
                  disabled={saved}
                  data-autofocus
                  onClick={() => {
                    saveLook({ title: outfit.title ?? "Try-on", prompt, outfit, items: pieces, preview: previewUrl ?? capture.dataUrl });
                    setSaved(true);
                    toast("Saved to Recent looks");
                  }}
                >
                  {saved ? "Saved" : "Save look"}
                </Button>
                {previewUrl && (
                  <Button icon="refresh" aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
                    {showOriginal ? "Show try-on" : "Before / after"}
                  </Button>
                )}
                <Button icon="sparkle" onClick={() => router.push("/smartmirror/stylist")}>
                  Try another
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="form-error" style={{ textAlign: "left" }}>
                {phase.message}
              </p>
              <Button icon="refresh" data-autofocus onClick={() => void start()}>
                Try again
              </Button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Plain words for the try-on failure codes (SmartMirror / HomePilot). */
function tryOnErrorText(code: string | null | undefined): string {
  const c = code ?? "";
  if (c.startsWith("CAPABILITY_UNAVAILABLE"))
    return "Image editing is switched off on your HomePilot. Turn on HOMEPILOT_MIRROR_JOBS_ENABLED and HOMEPILOT_MIRROR_IMAGE_EDIT_ENABLED.";
  if (c.startsWith("RESOURCE_REJECTED")) return "Your photo has expired or could not be read. Take a new photo and try again.";
  if (c.startsWith("NODE_RESTARTED")) return "Your HomePilot restarted during the try-on. Please try again.";
  if (c.startsWith("JOB_TIMEOUT")) return "Your HomePilot took too long. It may be busy; try again in a moment.";
  if (c.startsWith("IMAGE_EDIT_FAILED")) return "The try-on did not produce an image. Try a clearer, full-length photo.";
  return c || "Try-on failed";
}
