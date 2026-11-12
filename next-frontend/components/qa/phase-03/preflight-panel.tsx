"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { executeStep } from "@/lib/qa/phase-03/runner";
import { stepsOf } from "@/lib/qa/phase-03/steps";
import type { StepResult } from "@/lib/qa/phase-03/types";

import { ResultBadge } from "./status-badge";

const LABELS: Record<string, string> = {
  P1: "API no ar",
  P2: "Seed presente e token do dono válido",
  P3: "Token aceito em rota autenticada",
};

export function PreflightPanel() {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<Record<string, StepResult>>({});

  async function verify() {
    setChecking(true);
    setResults({});
    for (const step of stepsOf("preflight")) {
      const { result } = await executeStep(step, {}, { fetchImpl: (...a) => fetch(...a), getFile: () => undefined });
      setResults((r) => ({ ...r, [step.id]: result }));
    }
    setChecking(false);
  }

  const done = Object.keys(results).length === 3;
  const allOk = done && Object.values(results).every((r) => r.status === "pass");

  return (
    <Card className="px-4" aria-labelledby="preflight-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="preflight-title" className="text-h2">Pré-requisitos do ambiente</h2>
          <p className="text-body-md text-muted-foreground">
            Containers no ar (<code>docker compose up -d</code> em <code>nestjs-project/</code>), seed aplicada e API em :3000.
          </p>
        </div>
        <Button onClick={verify} disabled={checking}>{checking ? "Verificando…" : "Verificar ambiente"}</Button>
      </div>
      <ul className="space-y-2" aria-live="polite">
        {stepsOf("preflight").map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-body-md">
            <ResultBadge status={results[s.id]?.status} />
            <span>{LABELS[s.id]}</span>
            {results[s.id] && results[s.id].status !== "pass" && (
              <span className="text-[var(--destructive-text)]">
                {results[s.id].message ??
                  results[s.id].checks.filter((c) => !c.ok).map((c) => `${c.label}: recebido ${c.received}`).join("; ")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {done && (
        <p className="text-label-lg" role="status">
          {allOk ? "Ambiente pronto para testar." : "Ambiente com problemas: corrija antes de executar o roteiro (P2 404 = rode a seed; 401 = gere os tokens)."}
        </p>
      )}
    </Card>
  );
}
