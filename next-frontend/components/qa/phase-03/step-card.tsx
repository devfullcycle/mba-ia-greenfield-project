"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeCheck } from "@/lib/qa/phase-03/runner";
import { PROFILE_LABEL, type StepDef, type StepResult } from "@/lib/qa/phase-03/types";

import { ResultBadge } from "./status-badge";

interface StepCardProps {
  step: StepDef;
  result?: StepResult;
  running?: boolean;
  disabled?: boolean;
  onRun: (step: StepDef) => void;
}

export function StepCard({ step, result, running, disabled, onRun }: StepCardProps) {
  const failedChecks = result?.checks.filter((c) => !c.ok) ?? [];
  return (
    <Card id={`step-${step.id}`} className="scroll-mt-24 px-4" data-step={step.id} data-result={result?.status ?? "idle"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-h3">
            <span className="font-mono">{step.id}</span> — {step.title}
          </h4>
          <p className="text-body-md text-muted-foreground">{step.proves}</p>
          <p className="text-body-md">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-caption">{step.route}</span>{" "}
            <span className="text-caption text-muted-foreground">como {PROFILE_LABEL[step.profile]}</span>
          </p>
        </div>
        <Button size="sm" onClick={() => onRun(step)} disabled={disabled || running} aria-label={`Executar ${step.id}`}>
          {running ? "Executando…" : "Executar"}
        </Button>
      </div>

      <div>
        <p className="text-label-md">Resultado esperado</p>
        <ul className="list-inside list-disc text-body-md text-muted-foreground">
          {step.checks.map((c, i) => (
            <li key={i}>{describeCheck(c)}</li>
          ))}
        </ul>
      </div>

      <div aria-live="polite" className="space-y-2">
        <ResultBadge status={result?.status} />
        {result?.message && <p className="text-body-md">{result.message}</p>}
        {result?.videoStatusTrail && result.videoStatusTrail.length > 0 && (
          <p className="text-body-md">Status observados: {result.videoStatusTrail.join(" → ")}</p>
        )}
        {failedChecks.length > 0 && (
          <ul className="space-y-1 text-body-md text-[var(--destructive-text)]">
            {failedChecks.map((c, i) => (
              <li key={i}>
                {c.label}: esperado <strong>{c.expected}</strong>, recebido <strong>{c.received}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result && result.request && (
        <details className="text-body-md">
          <summary className="cursor-pointer rounded text-label-md focus-visible:ring-3 focus-visible:ring-ring/50">
            Ver detalhes
          </summary>
          <dl className="mt-2 grid gap-1 font-mono text-caption">
            <div>
              <dt className="font-sans font-semibold">Requisição</dt>
              <dd>
                {result.request.method} {result.request.url} (perfil: {result.request.profile})
              </dd>
              {result.request.headers && <dd>Cabeçalhos enviados: {JSON.stringify(result.request.headers)}</dd>}
              {result.request.body !== undefined && <dd>Corpo: {JSON.stringify(result.request.body)}</dd>}
            </div>
            <div>
              <dt className="font-sans font-semibold">Resposta ({result.httpStatus ?? "-"}, {result.durationMs} ms)</dt>
              <dd className="break-all">Cabeçalhos: {JSON.stringify(result.headers ?? {})}</dd>
              {result.bodyPreview && <dd className="break-all">Corpo: {result.bodyPreview}</dd>}
            </div>
            <div>
              <dt className="font-sans font-semibold">Verificações</dt>
              {result.checks.map((c, i) => (
                <dd key={i}>
                  {c.ok ? "✔" : "✘"} {c.label} (recebido: {c.received})
                </dd>
              ))}
            </div>
          </dl>
        </details>
      )}
    </Card>
  );
}
