---
kind: phase
name: phase-03-upload-processing-backend
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-upload-processing-backend/context.md: "2026-11-28T02:41:20-03:00"
  docs/decisions/technical-decisions-phase-03-upload-processing-backend.md: "2026-11-28T02:32:09-03:00"
  docs/decisions/technical-decisions-backend-nest12-runtime-test-runner.md: "2026-11-28T02:27:13-03:00"
issues:
  - id: IC-1
    status: resolved
    summary: "TD-12 decidido como B, mas a Recommendation em Decisions Detail descreve a A"
    resolved_by: phase-03-upload-processing-backend/TD-12
  - id: ICC-1
    status: resolved
    summary: "TD-12 B (Nest 12, mailer ^4) vs libs herdadas fixadas em majors da era Nest 11"
    resolved_by: phase-03-upload-processing-backend/TD-12
  - id: OQ-13
    status: resolved
    summary: "backend-nest12-runtime-test-runner/TD-01 pending — Baseline de Node do projeto"
    resolved_by: backend-nest12-runtime-test-runner/TD-01
  - id: OQ-14
    status: resolved
    summary: "backend-nest12-runtime-test-runner/TD-02 pending — Test runner do backend sob o Nest 12"
    resolved_by: backend-nest12-runtime-test-runner/TD-02
  - id: MD-1
    status: resolved
    summary: "Sem TD para Node/test runner exigidos pela migração ao Nest 12 (TD-12 B)"
    resolved_by: backend-nest12-runtime-test-runner/TD-01, TD-02
  - id: AMB-1
    status: resolved
    summary: "Limite do 'rascunho' da Fase 03 vs 'fluxo de rascunho e publicação' da Fase 04"
    resolved_by: clarification
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Object storage e ambiente local"
    resolved_by: phase-03-upload-processing-backend/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Protocolo de upload de até 10GB (contract FE↔BE)"
    resolved_by: phase-03-upload-processing-backend/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Fila de jobs de processamento"
    resolved_by: phase-03-upload-processing-backend/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Topologia do worker"
    resolved_by: phase-03-upload-processing-backend/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — Extração de metadados e thumbnail"
    resolved_by: phase-03-upload-processing-backend/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Entrega de streaming e download (contract de URLs)"
    resolved_by: phase-03-upload-processing-backend/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — Modelo de dados e ciclo de vida do vídeo"
    resolved_by: phase-03-upload-processing-backend/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — Identificador público único da URL"
    resolved_by: phase-03-upload-processing-backend/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Gatilho de conclusão do upload"
    resolved_by: phase-03-upload-processing-backend/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending — Limites, validação e limpeza"
    resolved_by: phase-03-upload-processing-backend/TD-10
  - id: OQ-11
    status: resolved
    summary: "TD-11 pending — Estratégia de testes (storage, fila e ffmpeg)"
    resolved_by: phase-03-upload-processing-backend/TD-11
  - id: OQ-12
    status: resolved
    summary: "TD-12 pending — Baseline de dependências do backend"
    resolved_by: phase-03-upload-processing-backend/TD-12
advisories: []
---

# phase-03-upload-processing-backend — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues
- **IC-1** _(resolved_by phase-03-upload-processing-backend/TD-12)_ — TD-12 decidido como B, mas a Recommendation descrevia a A. Revision adicionada ao TD-12: a Decision B prevalece, com a migração ao Nest 12 antes de TD-03 e TD-08. Rationale: priorizar zerar vulnerabilidades e defasagem de major já nesta fase.
- **ICC-1** _(resolved_by phase-03-upload-processing-backend/TD-12)_ — TD-12 B vs libs herdadas fixadas em majors do Nest 11. Revision adicionada ao TD-12: as libs companheiras seguem as versões que o `nest upgrade` fixar e substituem as majors dos TDs herdados. Os TDs herdados das Fases 01 e 02 não foram editados.
- **OQ-13** _(resolved_by backend-nest12-runtime-test-runner/TD-01)_ — Decidido: A (Node 24 LTS, a partir de 24.15).
- **OQ-14** _(resolved_by backend-nest12-runtime-test-runner/TD-02)_ — Decidido: A (manter Jest 30 com ts-jest atualizado, sobre Node 24.9+).
- **MD-1** _(resolved_by backend-nest12-runtime-test-runner/TD-01, TD-02)_ — Node/test runner do Nest 12: os TDs foram criados no doc ad-hoc `backend-nest12-runtime-test-runner` e estão pendentes (acompanhados em OQ-13 e OQ-14).

- **AMB-1** _(resolved_by clarification)_ — Limite do "rascunho" da Fase 03 vs "fluxo de rascunho e publicação" da Fase 04. Clarificação: a Fase 03 cobre só o ciclo técnico (registro e processamento, `uploading → ready/failed`). Visibilidade e publicação ficam com a Fase 04, como já diz o TD-07.
- **OQ-1** _(resolved_by phase-03-upload-processing-backend/TD-01)_ — Decidido: A (MinIO no compose, via API S3).
- **OQ-2** _(resolved_by phase-03-upload-processing-backend/TD-02)_ — Decidido: A (presigned S3 multipart direto ao storage), com os requisitos da fase anotados na Decision.
- **OQ-3** _(resolved_by phase-03-upload-processing-backend/TD-03)_ — Decidido: A (BullMQ + Redis).
- **OQ-4** _(resolved_by phase-03-upload-processing-backend/TD-04)_ — Decidido: A (mesmo codebase, 2º entrypoint em container próprio).
- **OQ-5** _(resolved_by phase-03-upload-processing-backend/TD-05)_ — Decidido: A (`spawn` direto com ffprobe/ffmpeg).
- **OQ-6** _(resolved_by phase-03-upload-processing-backend/TD-06)_ — Decidido: A (presigned GET + HTTP Range).
- **OQ-7** _(resolved_by phase-03-upload-processing-backend/TD-07)_ — Decidido: A (tabela `videos` com status enum).
- **OQ-8** _(resolved_by phase-03-upload-processing-backend/TD-08)_ — Decidido: B (id curto aleatório com unique index).
- **OQ-9** _(resolved_by phase-03-upload-processing-backend/TD-09)_ — Decidido: A (endpoint explícito `complete`).
- **OQ-10** _(resolved_by phase-03-upload-processing-backend/TD-10)_ — Decidido: A (validação em camadas, com job de limpeza).
- **OQ-11** _(resolved_by phase-03-upload-processing-backend/TD-11)_ — Decidido: C (híbrido).
- **OQ-12** _(resolved_by phase-03-upload-processing-backend/TD-12)_ — Decidido: B (Option A + migração para Nest 12 na própria fase), divergindo da recomendação do doc (Option A).
