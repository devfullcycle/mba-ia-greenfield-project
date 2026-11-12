"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const STAGES = ["DRAFT", "PROCESSING", "READY"] as const;

export type Stage = (typeof STAGES)[number] | "ERROR" | null;

interface UploadPanelProps {
  videoId: string;
  onVideoIdChange: (id: string) => void;
  sampleSize?: number;
  fileLabel?: string;
  onUseSample: () => void;
  onFile: (file: File | undefined) => void;
  stage: Stage;
  pollElapsedSeconds?: number;
  polling: boolean;
  onRepoll: () => void;
}

export function UploadPanel(p: UploadPanelProps) {
  const current = p.stage === "ERROR" ? 2 : p.stage ? STAGES.indexOf(p.stage) : -1;
  return (
    <div className="space-y-4 rounded-[var(--radius-2)] border border-border p-4">
      <h3 className="text-h3">Dados do upload</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="qa-video-id">Video ID do fluxo de upload</Label>
          <Input id="qa-video-id" value={p.videoId} onChange={(e) => p.onVideoIdChange(e.target.value)} placeholder="preenchido ao executar U1" />
          <p className="text-caption text-muted-foreground">Preenchido sozinho pelo passo U1; edite para repetir os passos em outro vídeo.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="qa-file">Arquivo de vídeo (até 5 MiB, uma parte)</Label>
          <Input id="qa-file" type="file" accept="video/*" onChange={(e) => p.onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-2">
            {p.sampleSize !== undefined && (
              <Button type="button" size="sm" variant="secondary" onClick={p.onUseSample}>
                Usar vídeo de exemplo ({p.sampleSize} bytes)
              </Button>
            )}
            <span className="text-caption text-muted-foreground" aria-live="polite">
              {p.fileLabel ? `Selecionado: ${p.fileLabel}` : "Nenhum arquivo selecionado"}
            </span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-label-md">Andamento do processamento</p>
        <ol className="mt-2 flex flex-wrap items-center gap-2" aria-live="polite">
          {STAGES.map((s, i) => {
            const label = p.stage === "ERROR" && s === "READY" ? "ERROR" : s;
            const done = i < current || (i === current && p.stage === "READY");
            const active = i === current && !done;
            return (
              <li
                key={s}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-body-md",
                  done && "border-[var(--success-text)] text-[var(--success-text)]",
                  active && p.stage !== "ERROR" && "border-[var(--warning-text)] text-[var(--warning-text)]",
                  p.stage === "ERROR" && i === 2 && "border-[var(--destructive-text)] text-[var(--destructive-text)]",
                  !done && !active && !(p.stage === "ERROR" && i === 2) && "border-border text-muted-foreground",
                )}
              >
                {done ? "✔ " : ""}
                {label}
              </li>
            );
          })}
          {p.polling && <li className="text-body-md text-muted-foreground">verificando… {p.pollElapsedSeconds ?? 0} s de 60 s</li>}
        </ol>
        <Button className="mt-3" size="sm" variant="outline" onClick={p.onRepoll} disabled={p.polling || !p.videoId}>
          Refazer polling (U5)
        </Button>
      </div>
    </div>
  );
}
