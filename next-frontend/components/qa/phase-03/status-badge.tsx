import { cn } from "@/lib/utils";
import type { StepStatus } from "@/lib/qa/phase-03/types";

const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium whitespace-nowrap";

const VIDEO_TONE: Record<string, string> = {
  READY: "border-[var(--success-text)] text-[var(--success-text)]",
  PROCESSING: "border-[var(--warning-text)] text-[var(--warning-text)]",
  DRAFT: "border-border text-muted-foreground",
  ERROR: "border-[var(--destructive-text)] text-[var(--destructive-text)]",
};

export function VideoStatusBadge({ status }: { status: string }) {
  return <span className={cn(base, VIDEO_TONE[status] ?? "border-border text-muted-foreground")}>{status}</span>;
}

const RESULT: Record<StepStatus | "idle", { text: string; tone: string }> = {
  pass: { text: "✔ Passou", tone: "border-[var(--success-text)] text-[var(--success-text)]" },
  fail: { text: "✘ Falhou", tone: "border-[var(--destructive-text)] text-[var(--destructive-text)]" },
  error: { text: "✘ Erro de execução", tone: "border-[var(--destructive-text)] text-[var(--destructive-text)]" },
  blocked: { text: "⚠ Bloqueado", tone: "border-[var(--warning-text)] text-[var(--warning-text)]" },
  idle: { text: "Não executado", tone: "border-border text-muted-foreground" },
};

export function ResultBadge({ status }: { status?: StepStatus }) {
  const r = RESULT[status ?? "idle"];
  return <span className={cn(base, r.tone)}>{r.text}</span>;
}
