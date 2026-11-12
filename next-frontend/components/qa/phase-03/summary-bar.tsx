"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { StepDef } from "@/lib/qa/phase-03/types";

interface SummaryBarProps {
  total: number;
  executed: number;
  passed: number;
  failed: StepDef[];
  busy: boolean;
  onRunAll: () => void;
  onClear: () => void;
  getReport: () => string;
}

export function SummaryBar({ total, executed, passed, failed, busy, onRunAll, onClear, getReport }: SummaryBarProps) {
  const [copied, setCopied] = useState<"ok" | "err" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(getReport());
      setCopied("ok");
    } catch {
      setCopied("err");
    }
  }

  const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
  return (
    <section aria-label="Resumo" className="sticky top-0 z-10 space-y-3 border-b border-border bg-background/95 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-h3" aria-live="polite">
          {passed} de {total} passos passaram
          <span className="ml-2 text-body-md text-muted-foreground">({executed} executados)</span>
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={onRunAll} disabled={busy}>
            {busy ? "Executando…" : "Executar tudo"}
          </Button>
          <Button size="sm" variant="outline" onClick={copy}>
            Copiar relatório
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
            Limpar resultados
          </Button>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Passos aprovados"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={passed}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--progress-track)]"
      >
        <div className="h-full bg-[var(--success-text)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      {copied && (
        <p className="text-body-md" role="status">
          {copied === "ok" ? "Relatório copiado para a área de transferência." : "Não foi possível copiar; selecione e copie manualmente."}
        </p>
      )}
      {failed.length > 0 && (
        <p className="text-body-md text-[var(--destructive-text)]">
          Com problema:{" "}
          {failed.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <a className="underline" href={`#step-${s.id}`}>
                {s.id}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
