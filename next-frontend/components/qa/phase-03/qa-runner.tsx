"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  applyPatch,
  buildReport,
  executeStep,
  shouldStop,
  summarize,
  type RunnerDeps,
} from "@/lib/qa/phase-03/runner";
import { SECTIONS, STEPS, stepsOf } from "@/lib/qa/phase-03/steps";
import type { Ctx, SectionId, StepDef, StepResult } from "@/lib/qa/phase-03/types";

import { StepCard } from "./step-card";
import { SummaryBar } from "./summary-bar";
import { UploadPanel, type Stage } from "./upload-panel";
import { VideoGallery } from "./video-gallery";

const STORAGE_KEY = "qa-phase-03-v1";

interface Persisted {
  ctx: Ctx;
  results: Record<string, StepResult>;
}

function load(): Persisted | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : undefined;
  } catch {
    return undefined;
  }
}

function save(data: Persisted) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage may be unavailable (private mode); the page works without persistence.
  }
}

function slim(r: StepResult): StepResult {
  return { ...r, bodyPreview: r.bodyPreview?.slice(0, 500) };
}

export function QaRunner({ sampleSize }: { sampleSize?: number }) {
  const [ctx, setCtx] = useState<Ctx>({});
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileLabel, setFileLabel] = useState<string>();
  const [poll, setPoll] = useState<{ status: string; elapsed: number } | null>(null);
  const [galleryToken, setGalleryToken] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const fileRef = useRef<Blob | undefined>(undefined);
  // Mirrors state so sequential runs read the latest values without waiting for re-render.
  const ctxRef = useRef<Ctx>({});

  useEffect(() => {
    // Deferred so the first client render matches the server HTML (no sessionStorage on the server).
    const t = setTimeout(() => {
      const stored = load();
      if (stored) {
        ctxRef.current = stored.ctx;
        setCtx(stored.ctx);
        setResults(stored.results);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (hydrated) save({ ctx, results });
  }, [ctx, results, hydrated]);

  const loadSample = useCallback(async (): Promise<Blob | undefined> => {
    try {
      const res = await fetch("/api/qa/phase-03/sample", { cache: "no-store" });
      if (!res.ok) return undefined;
      const blob = await res.blob();
      fileRef.current = new File([blob], "sample.mp4", { type: "video/mp4" });
      setFileLabel(`sample.mp4 (exemplo, ${blob.size} bytes)`);
      return fileRef.current;
    } catch {
      return undefined;
    }
  }, []);

  const deps: RunnerDeps = {
    fetchImpl: (...args) => fetch(...args),
    getFile: () => fileRef.current,
    onPoll: (status, elapsedMs) => setPoll({ status, elapsed: Math.round(elapsedMs / 1000) }),
  };

  async function runOne(step: StepDef): Promise<StepResult> {
    setRunningId(step.id);
    if (step.kind === "poll") setPoll({ status: "…", elapsed: 0 });
    const { result, ctxPatch } = await executeStep(step, ctxRef.current, deps);
    const next = applyPatch(ctxRef.current, ctxPatch, step.id);
    ctxRef.current = next;
    setCtx(next);
    setResults((r) => ({ ...r, [step.id]: slim(result) }));
    setRunningId(null);
    if (step.kind === "poll") setPoll((p) => (p ? { ...p, elapsed: p.elapsed } : p));
    setGalleryToken((t) => t + 1);
    return result;
  }

  async function runSteps(steps: StepDef[]) {
    for (const step of steps) {
      if (step.kind === "upload" && !fileRef.current && sampleSize !== undefined) await loadSample();
      const result = await runOne(step);
      if (shouldStop(step, result)) break;
    }
  }

  async function guarded(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const onRunStep = (step: StepDef) => guarded(() => runSteps([step]).then(() => undefined));
  const onRunSection = (id: SectionId) => guarded(() => runSteps(stepsOf(id)));
  const onRunAll = () =>
    guarded(async () => {
      for (const s of SECTIONS) await runSteps(stepsOf(s.id));
    });

  function onClear() {
    ctxRef.current = {};
    setCtx({});
    setResults({});
    setPoll(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  const summary = summarize(results);
  const u5 = results["U5"];
  const stage: Stage = poll?.status === "ERROR" || poll?.status === "READY" || poll?.status === "PROCESSING"
    ? (poll.status as Stage)
    : results["U4"]?.status === "pass"
      ? "PROCESSING"
      : results["U1"]?.status === "pass"
        ? "DRAFT"
        : null;
  const finalStage: Stage = u5?.videoStatusTrail?.length ? (u5.videoStatusTrail.at(-1) as Stage) : stage;

  return (
    <div className="space-y-8">
      <SummaryBar
        total={summary.total}
        executed={summary.executed}
        passed={summary.passed}
        failed={summary.failed}
        busy={busy}
        onRunAll={onRunAll}
        onClear={onClear}
        getReport={() => buildReport(results, ctxRef.current)}
      />

      <UploadPanel
        videoId={ctx.videoId ?? ""}
        onVideoIdChange={(id) => {
          const next = { ...ctxRef.current, videoId: id || undefined };
          ctxRef.current = next;
          setCtx(next);
        }}
        sampleSize={sampleSize}
        fileLabel={fileLabel}
        onUseSample={() => void loadSample()}
        onFile={(f) => {
          fileRef.current = f;
          setFileLabel(f ? `${f.name} (${f.size} bytes)` : undefined);
        }}
        stage={poll ? stage : finalStage}
        polling={runningId === "U5"}
        pollElapsedSeconds={poll?.elapsed}
        onRepoll={() => void onRunStep(STEPS.find((s) => s.id === "U5")!)}
      />

      {SECTIONS.map((section) => (
        <section key={section.id} id={`section-${section.id}`} aria-labelledby={`title-${section.id}`} className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id={`title-${section.id}`} className="text-h2">{section.title}</h2>
              <p className="text-body-md text-muted-foreground">{section.intro}</p>
            </div>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRunSection(section.id)}>
              Executar seção
            </Button>
          </div>
          <div className="grid gap-3">
            {stepsOf(section.id).map((step) => (
              <StepCard key={step.id} step={step} result={results[step.id]} running={runningId === step.id} disabled={busy} onRun={onRunStep} />
            ))}
          </div>
        </section>
      ))}

      <VideoGallery sessionVideoIds={ctx.sessionVideoIds ?? []} refreshToken={galleryToken} />
    </div>
  );
}
