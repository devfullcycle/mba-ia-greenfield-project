# Fase NN — [Nome da Fase] — Progresso

> Modelo reutilizável para `docs/phases/phase-NN-progress.md`. Substitua `NN` e `[Nome da Fase]`. Mantenha as seções mesmo quando vazias — preencha com "Pendente" ou "N/A" em vez de remover a seção. Cada seção é atualizada apenas pela Skill responsável por ela (ver comentário `<!-- owner: ... -->`); as demais Skills leem, mas não escrevem fora da sua seção.

**Status geral:** not_started | baseline_ok | research_ok | planning_ok | implementing | quality_gate_ok | validated | documented | completed
**Branch:** `feature/phase-NN-...`
**Última atualização:** YYYY-MM-DD por `<skill-name>`

---

## 1. Baseline

<!-- owner: streamtube-phase-orchestrator -->

- **Branch atual:** `<nome>` (esperado: `feature/phase-NN-*`, nunca `main`/`dev`)
- **Git status na abertura:** limpo | alterações não commitadas (`<resumo>`)
- **Baseline validada:** Sim/Não — testes e build da fase anterior passam antes de iniciar esta fase
- **Enunciado oficial localizado em:** `docs/project-plan.md` (seção "Fase NN") ou `docs/phases/phase-NN-*.md` se já existir
- **Observações:**

---

## 2. Research

<!-- owner: streamtube-phase-research -->

- **Documento:** `docs/phases/phase-NN-research.md` — Criado | Em andamento | Pendente
- **Requisitos e critérios de aceite extraídos:** Sim/Não
- **Código existente auditado:** Sim/Não (módulos/arquivos relevantes: `<lista>`)
- **Alternativas comparadas:** `<lista de TDs relevantes ou "nenhuma decisão técnica em aberto">`
- **Decisões ainda não tomadas (bloqueiam planning):** `<lista ou "nenhuma">`
- **Observações:**

---

## 3. Planning

<!-- owner: streamtube-phase-planning -->

- **Documento:** `docs/phases/phase-NN-plan.md` — Criado | Em andamento | Pendente
- **Plano técnico detalhado (SIs), se existir:** `docs/phases/phase-NN-[slug].md`
- **Arquitetura/domínio/estados/endpoints/infra definidos:** Sim/Não
- **Total de incrementos definidos:** N
- **Observações:**

---

## 4. Incrementos

<!-- owner: streamtube-increment-implementation -->

| Incremento | Status | Testes | Arquivos alterados | Observações |
|---|---|---|---|---|
| INC-NN.1 — `<nome>` | pending / in_progress / completed | `<resultado ou "sem testes">` | `<lista>` | |

> Uma linha por incremento, na ordem de execução. Atualizado ao final de cada execução de `streamtube-increment-implementation` — nunca em lote.

---

## 5. Quality Gate

<!-- owner: streamtube-quality-gate -->

- **Execução mais recente:** YYYY-MM-DD HH:MM
- **Docker Compose (`config`/`ps`/logs):** OK / FALHA — `<evidência resumida>`
- **Migrations:** OK / FALHA
- **Testes unit+integration (`--runInBand`):** `<X/Y passando>`
- **Testes e2e (`--runInBand`):** `<X/Y passando>`
- **TypeScript (`tsc --noEmit`):** OK / FALHA
- **Regressão de fases anteriores:** OK / FALHA — `<detalhe>`
- **Veredito:** CLEAN | DIRTY
- **Observações:**

---

## 6. Validação Manual

<!-- owner: streamtube-manual-validation -->

- **Documento:** `docs/phases/phase-NN-validation.md` — Criado | Em andamento | Pendente
- **Endpoints reais levantados:** N
- **Endpoints validados (sucesso + erro):** N/N
- **Efeitos verificados:** PostgreSQL `<Sim/Não>` · Mailpit `<Sim/Não/N-A>` · MinIO `<Sim/Não/N-A>` · Redis `<Sim/Não/N-A>` · Worker `<Sim/Não/N-A>`
- **Observações:**

---

## 7. Documentação

<!-- owner: streamtube-phase-documentation -->

- **Pré-requisito (Quality Gate CLEAN):** Sim/Não — só editar esta seção se Sim
- **README atualizado:** Sim/Não
- **Documentação de arquitetura/variáveis/comandos/troubleshooting atualizada:** Sim/Não
- **Arquivos alterados:** `<lista>`
- **Observações:**

---

## 8. Commits

<!-- owner: streamtube-phase-orchestrator -->

> Nenhuma Skill deste conjunto cria commits automaticamente. Esta seção só é preenchida manualmente pelo usuário ou quando o usuário autoriza explicitamente um commit em uma sessão.

- **Commits realizados nesta fase:** `<lista de hashes/mensagens ou "nenhum">`
- **Autorizado por:** `<usuário, quando aplicável>`

---

## 9. Pendências

<!-- owner: streamtube-phase-orchestrator -->

> Itens fora do escopo identificados durante a fase, decisões técnicas não resolvidas, dívidas conhecidas. Não é uma lista de tarefas da fase — é o que fica para depois.

- `<pendência>` — origem: `<skill/etapa>`
