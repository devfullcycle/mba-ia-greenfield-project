import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QaRunner } from "@/components/qa/phase-03/qa-runner";
import { PreflightPanel } from "@/components/qa/phase-03/preflight-panel";
import { env } from "@/lib/env";
import { getSampleSize } from "@/lib/qa/phase-03/sample";

export const metadata: Metadata = { title: "QA Fase 03 — StreamTube" };
// Depends on the container filesystem and env at request time.
export const dynamic = "force-dynamic";

export default async function QaPhase03Page() {
  if (env.NODE_ENV === "production") notFound();
  const sampleSize = await getSampleSize();

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8">
      <header className="space-y-3">
        <h1 className="text-display">QA — Fase 03: upload, processamento e mídia</h1>
        <p className="text-body-lg">
          Esta página executa, com botões, o roteiro de <code>docs/phases/phase-03-videos/manual-api-test.md</code>. Cada passo
          faz uma chamada real à API, compara o resultado com o esperado e mostra ✔ Passou ou ✘ Falhou. Nenhum login é necessário:
          os perfis (dono, outro usuário, anônimo) usam tokens de teste guardados no servidor.
        </p>
        <p className="text-body-md text-muted-foreground">
          Ferramenta só para desenvolvimento. Ordem sugerida: Verificar ambiente → Executar tudo → copiar o relatório como evidência.
          O envio do arquivo ao armazenamento (passo U2) é feito pelo servidor desta página.
        </p>
      </header>
      <PreflightPanel />
      <QaRunner sampleSize={sampleSize} />
    </main>
  );
}
